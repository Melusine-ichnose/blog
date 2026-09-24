---
title: 源码阅读笔记：Seat Reservation System 的定时任务与状态机设计
published: 2026-09-24
tags: [源码解析, SpringBoot, Vue, 状态机]
category: 源码解析
draft: false
slug: seat-reservation-analysis
description: 分析自习室座位预约系统的核心设计：座位状态机流转、TimerTask 定时异常处理、信用分奖惩机制。
image: "../../assets/images/yanami/cover-sakura.png"
---

# Seat Reservation System 源码阅读笔记

[Seat Reservation System](https://github.com/Melusine-ichnose/Seat-Reservation-System) 是一个前后端分离的自习室座位预约系统（Spring Boot 2.7 + Vue 2）。这篇文章记录我阅读它的源码时，认为最值得学习的三个设计。

## 一、座位状态机：用数字流转约束业务规则

自习室座位的核心是一个状态机。`reservation` 表的 `status` 字段定义了完整流转：

| 状态值 | 含义 | 触发动作 |
|---|---|---|
| 0 | 待签到 | 用户预约成功 |
| 1 | 使用中 | 到场扫码签到 |
| 2 | 未及时签到 | 超时自动判违规 |
| 3 | 暂离 | 用户主动暂离 |
| 4 | 暂离超时 | 定时任务检测 |
| -1 | 完成 | 使用结束，释放座位 |

这个设计的价值在于：**所有业务操作最终都收敛为状态变更**。

- 用户签到 → `0 → 1`
- 用户暂离 → `1 → 3`
- 用户回来 → `3 → 1`
- 暂离超时 → `3 → 4`
- 使用结束 → `1 → -1`

每个状态变更都绑定一个副作用（释放座位 / 扣信用分 / 记违规），代码路径非常清晰。

## 二、TimerTask：异常场景的自动兜底

系统最复杂的地方不是正常流程，而是**异常场景**。预约了不来怎么办？暂离了一直不回来怎么办？

项目的答案是 `TimerTask` 定时任务：

```java
// 伪代码示意：预约超时未签到自动判违规
TimerTask checkSignTimeout = new TimerTask() {
    @Override
    public void run() {
        // 找到所有 status=0 且超过签到时间的预约
        List<Reservation> timeoutList = reservationMapper
            .findTimeoutReservations(now());

        for (Reservation r : timeoutList) {
            r.setStatus(2); // 未及时签到
            seatService.release(r.getSeatId());
            creditService.deduct(r.getUserId(), 10); // 扣信用分
            violationService.record(r.getId(), "超时未签到");
        }
    }
};
```

定时任务每 N 分钟扫一次，把「应该发生但用户没做」的事情自动补掉。这是典型的**最终一致性**思路——不依赖用户操作，系统自己兜底。

## 三、信用分：约束行为的奖惩机制

信用分是这个系统里很巧妙的约束设计：

- 初始 100 分
- 超时未签到 → 扣分
- 暂离超时 → 扣分
- 教师可手动加/扣分
- 信用分过低 → 限制预约权限

它不是简单的惩罚，而是**用分数门槛间接控制资源分配**。分数低的人自动失去预约资格，不需要管理员手动拉黑。

## 前端：双 UI 库的组合

这个项目的前端架构也值得注意：

- **PC 端管理界面** → Element UI 2.15（给管理员/教师用）
- **移动端 H5** → Vant 2.12（给学生用）

同一套后端 API，根据设备类型加载不同的 UI 库。Axios 统一封装，通过 `devServer.proxy` 把 `/api` 代理到后端 9003 端口。

## 总结

这个项目的复杂度不高，但**异常处理的设计意识**很到位。定时任务兜底、状态机约束流转、信用分约束行为，这三板斧在很多业务系统里都适用。

项目地址：[github.com/Melusine-ichnose/Seat-Reservation-System](https://github.com/Melusine-ichnose/Seat-Reservation-System)
