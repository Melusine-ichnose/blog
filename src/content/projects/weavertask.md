---
title: "TaskWeaver - 基于 LangGraph 的 AI Agent"
slug: taskweaver
published: 2026-09-01
draft: false
order: 100
description: "基于 LangGraph 状态图编排的生产级 AI Agent 服务，支持任务自主规划、工具调用、反思校验与多轮对话记忆。"
image: "../../assets/images/yanami/cover-night.png"
status: "published"
tags:
  - Python
  - LangGraph
  - AI Agent
  - FastAPI
  - MCP
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/Melusine-ichnose/TaskWeaver"
---

## 项目简介

TaskWeaver 是一个基于 LangGraph 状态图编排的生产级 AI Agent 服务。采用 **Planner → Executor → Reviewer → Responder** 四节点循环架构，实现任务自主规划、工具调用、反思校验与多轮对话记忆。

工具层基于 MCP（Model Context Protocol）协议独立部署、热插拔扩展；服务以 FastAPI 提供 REST API 与 Web 控制台，支持 OpenAI 兼容协议接入 DeepSeek / OpenAI / 通义等主流大模型，Docker Compose 双容器一键部署。

## 技术栈

Python、LangGraph、LangChain、MCP 协议、FastAPI、Uvicorn、SQLite、httpx、Pydantic、LangSmith、JavaScript

## 核心设计

### 状态机 Agent 架构

基于 LangGraph 实现 Planner-Executor-Reviewer-Responder 循环执行链路，实现复杂任务自动拆解、工具调用、结果校验。

### 死循环防护

新增双层计数器 + 框架兜底的死循环防护，限制总评审次数、单步最大重试次数，解决 Agent 空转引发递归超限报错与 Token 浪费；评审逻辑增加关键词容错，避免流程卡死。

### 性能优化

针对简单请求实现快速通道，跳过冗余模型调用，将简单任务 LLM 调用次数由 8-9 次下降至 2 次，响应耗时从 40-60s 优化至 2-4s，复杂任务保留完整校验流程保障输出质量。

### 会话持久化

基于 AsyncSqliteSaver 实现异步会话持久化，按会话 ID 隔离上下文，支持断点续跑；使用 FastAPI 对外提供 REST 接口，配套 Web 管理控制台。
