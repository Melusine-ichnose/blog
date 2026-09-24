---
title: "Seat Reservation System - 自习室座位预约系统"
slug: seat-reservation
published: 2026-03-01
draft: false
order: 70
description: "Spring Boot + Vue2 前后端分离的自习室座位预约系统，支持三种角色，含状态机流转与定时任务自动兜底。"
image: "../../assets/images/yanami/cover-seat.jpg"
status: "published"
tags:
  - Java
  - SpringBoot
  - Vue
  - MySQL
  - Redis
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/Melusine-ichnose/Seat-Reservation-System"
---

## 项目简介

基于 Spring Boot + Vue2 的前后端分离自习室座位预约系统，支持学生 / 教师 / 管理员三种角色。提供区域选择、座位预约、扫码签到、暂离管理、信用分奖惩、违规记录、公告与论坛等完整功能，并通过 TimerTask 定时任务自动处理超时未签到、暂离超时等异常场景。

## 技术栈

- 后端：Spring Boot 2.7、Java 17、MyBatis、MySQL 8、Redis
- 前端：Vue 2.6、Element UI（PC 端）、Vant（移动端 H5）、Axios
