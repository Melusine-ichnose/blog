---
title: TaskWeaver 源码解析：LangGraph 四节点循环 Agent 架构
published: 2026-09-24
tags: [源码解析, LangGraph, AI Agent, Python]
category: 源码解析
draft: false
slug: taskweaver-source-analysis
description: 深入 TaskWeaver 源码，拆解 Planner-Executor-Reviewer-Responder 四节点循环图的实现，以及它如何用双计数器防止 Agent 死循环。
image: "../../assets/images/yanami/cover-manga.png"
---

# TaskWeaver 源码解析：LangGraph 四节点循环 Agent 架构

[TaskWeaver](https://github.com/Melusine-ichnose/TaskWeaver) 是一个基于 LangChain + LangGraph + MCP 协议 + FastAPI 的生产级 AI Agent 服务。这篇文章带你读它的核心源码，看看一个可落地的 Agent 循环是怎么搭起来的。

## 整体架构：一张循环图

项目的灵魂在 `app/agent/graph.py`，整个 Agent 就是一张 LangGraph 状态图：

```text
START → planner → executor → reviewer ┐
                      ▲               │
                      └── not done ───┤
                                      │
                      done → responder → END
```

对应源码（来自 [graph.py](https://github.com/Melusine-ichnose/TaskWeaver/blob/main/app/agent/graph.py)）：

```python
graph = StateGraph(AgentState)

graph.add_node("planner", planner_node)
graph.add_node("executor", executor_node)
graph.add_node("reviewer", reviewer_node)
graph.add_node("responder", responder_node)

graph.add_edge(START, "planner")
graph.add_edge("planner", "executor")
graph.add_edge("executor", "reviewer")

# 条件边：reviewer 决定继续执行还是收尾
graph.add_conditional_edges(
    "reviewer",
    _route_after_review,
    {"executor": "executor", "responder": "responder"},
)

graph.add_edge("responder", END)
```

四个节点的职责划分非常清晰：

| 节点 | 职责 | 类比 |
|---|---|---|
| Planner | 把用户问题拆解成步骤清单 | 项目经理排计划 |
| Executor | 执行当前步骤，调工具或直接产出 | 干活的工程师 |
| Reviewer | 评审当前步骤是否完成 | 质检/Code Review |
| Responder | 汇总所有步骤产出，生成最终回答 | 写交付报告 |

## 状态设计：AgentState

LangGraph 的核心思想是**节点之间不直接传参，而是读写共享状态**。`app/agent/state.py` 定义了这个共享状态：

```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    user_query: str
    plan: list[str]
    current_step_index: int
    step_results: list[str]
    is_complete: bool
    final_response: str
    review_iterations: int  # 防死循环计数器
```

两个值得注意的设计：

1. **`messages` 用了 `add_messages` reducer**：LangGraph 默认对状态字段是覆盖更新，但 `messages` 声明了 reducer 后，每个节点返回的新消息会**自动追加合并**而不是覆盖，对话历史就这样自然累积起来了。
2. **`review_iterations` 显式计数**：这是防止 Agent 死循环的关键，后面详细说。

## Reviewer：最值得学的节点

`app/agent/nodes/reviewer.py` 是整个项目里工程思考最密集的部分。它要回答一个问题：**当前步骤算完成了吗？**

### 三层防护，防死循环烧 Token

```python
MAX_REVIEW_ITERATIONS = 12  # 单次图执行最大评审次数
MAX_STEP_RETRIES = 2        # 单步最大重试次数
```

**第一层：总评审次数硬上限。** 达到 12 次直接强制收尾，而且这个判断**先于 LLM 调用**，不消耗任何 token：

```python
if iterations >= MAX_REVIEW_ITERATIONS:
    return {"review_iterations": iterations, "is_complete": True}
```

**第二层：单步重试上限。** 同一步骤连续 2 次评审不过，强制推进到下一步——宁可带着不完美的结果往前走，也不在一个步骤上空转：

```python
step_retries = state.get("step_retry_count", 0) + 1
if step_retries >= MAX_STEP_RETRIES:
    # 强制推进
    return {"current_step_index": next_index, ...}
```

**第三层：LLM 输出兜底的「安全侧」判定。** Reviewer 让 LLM 输出 DONE/CONTINUE，但 LLM 的输出你永远不能完全信任。这里的取舍是：**无法判定时默认完成**——

```python
if has_done:
    is_step_done = True
elif has_continue:
    is_step_done = False
else:
    # 无法识别时默认完成（安全侧，防死循环烧 token）
    is_step_done = True
```

为什么默认完成而不是默认继续？因为「继续」意味着再跑一轮 Executor → 再调一次 LLM → 再烧一轮 token，而且可能永远不满足。默认完成是**成本安全侧**的选择。这是做 Agent 系统和写普通业务代码思路差别最大的地方：你要时刻假设 LLM 会给出无法解析的输出。

### 单步任务快速通道：省掉一次 LLM 调用

对于单步任务（`len(plan) == 1`），reviewer 先跑一个**不调 LLM** 的本地判定：

```python
def _autocomplete_single_step(messages: list) -> bool | None:
    last = messages[-1]
    if isinstance(last, ToolMessage):
        if content.startswith("错误"):
            return None   # 工具失败，交给 LLM 评审
        return True        # 工具成功 → 完成
    if isinstance(last, AIMessage):
        if last.content and not last.tool_calls:
            return True    # Executor 已直接产出答案 → 完成
    return None            # 不确定 → 走 LLM 评审
```

逻辑很朴素：Executor 刚跑完，如果消息序列末尾是一个成功的工具结果或一段正常的 AI 文本，这一步就完成了，没必要再问一次 LLM「你觉得完成了吗」。就这么一个判断，把简单请求的 LLM 调用次数砍掉了一大半。

## Executor：工具调用的经典模式

`executor_node` 展示了 LangChain 体系下标准的工具调用循环：

```python
response: AIMessage = await llm.ainvoke(messages)
tool_calls = getattr(response, "tool_calls", None) or []

for tool_call in tool_calls:
    tool = next((t for t in tools if t.name == tool_call["name"]), None)
    if tool is None:
        content = f"错误：未找到工具 '{tool_call['name']}'"
    else:
        try:
            result = await tool.ainvoke(tool_call["args"])
            content = str(result)
        except Exception as e:
            content = f"工具执行错误: {e}"
    new_messages.append(ToolMessage(content=content, ...))
```

要点：**工具的异常从不向上抛，而是包成错误文本写进 ToolMessage**。这样 LLM 下一轮能「看到」工具失败了，有机会自己换参数重试或换个工具——把错误也变成 LLM 可利用的上下文。

## 学到的三件事

1. **Agent 的可靠性来自工程防护，不是 Prompt。** 双计数器 + 兜底判定这些「无聊」的代码，才是生产环境和玩具 Demo 的分水岭。
2. **把 LLM 放在路径的关键决策点上，其他地方尽量不调。** 单步快速通道省的是真金白银的 token 和延迟。
3. **状态图（StateGraph）天然适合表达 Agent 循环。** 比起手写 while 循环，图结构让「评审不过就回到 Executor」这种回边表达得直白且可视化（配合 LangSmith 能直接看到每次循环的轨迹）。

项目地址：[github.com/Melusine-ichnose/TaskWeaver](https://github.com/Melusine-ichnose/TaskWeaver)
