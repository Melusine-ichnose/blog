---
title: "DeepStudy - CNN 手写数字识别"
slug: deepstudy
published: 2026-05-01
draft: false
order: 80
description: "使用 PyTorch 构建卷积神经网络，在 MNIST 数据集上完成手写数字分类，5 轮训练准确率达 99%。"
image: "../../assets/images/yanami/cover-deepstudy.jpg"
status: "published"
tags:
  - Python
  - PyTorch
  - CNN
  - 深度学习
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/Melusine-ichnose/DeepStudy"
---

## 项目简介

使用 PyTorch 构建卷积神经网络（CNN），在 MNIST 数据集上完成手写数字（0-9）的分类任务。项目包含完整的模型训练、评估、保存与加载预测流程，5 轮训练后测试集准确率可达 99% 左右。

## 网络结构

| 层 | 输出尺寸 | 说明 |
| --- | --- | --- |
| 输入 | 1 × 28 × 28 | 灰度手写数字图像 |
| Conv1 + ReLU + MaxPool | 32 × 14 × 14 | 3×3 卷积 |
| Conv2 + ReLU + MaxPool | 64 × 7 × 7 | 3×3 卷积 |
| Conv3 + ReLU + MaxPool | 128 × 3 × 3 | 3×3 卷积 |
| Flatten | 1152 | 展平 |
| FC1 + ReLU + Dropout | 128 | 全连接层 |
| FC2 + LogSoftmax | 10 | 输出 10 个类别 |
