---
title: "bill-splitter - 合租账单分摊器"
slug: bill-splitter
published: 2026-06-01
draft: false
order: 90
description: "单 HTML 文件的合租账单自动分摊工具，最大余数法分摊算法，零依赖，双击即可使用。"
image: "../../assets/images/yanami/cover-1.jpg"
status: "published"
tags:
  - JavaScript
  - 纯函数
  - 工具
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/Melusine-ichnose/bill-splitter"
---

## 项目简介

三人合租账单自动分摊工具。双击 `bill-splitter.html` 即可在浏览器打开，全程断网可用，零外部依赖。

## 核心设计

核心是一个 `__split(totalCents, weights)` 纯函数，满足四条不变量：长度一致、整数分、金额守恒、纯函数确定性。采用最大余数法分摊，零头集中给余数最大的人，保证可解释性。

支持按天数比例分摊、包月均分、自定义权重三种模式，通过修改权重数组配置即可切换，无需改动算法。
