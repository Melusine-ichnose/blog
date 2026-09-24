---
title: DeepStudy 源码解析：三层卷积 CNN 的标准训练范式
published: 2026-09-24
tags: [源码解析, PyTorch, 深度学习, Python]
category: 源码解析
draft: false
slug: deepstudy-source-analysis
description: 拆解 DeepStudy 的 MNIST CNN 实现：三层卷积的尺寸推导、log_softmax+NLLLoss 组合、训练五步循环与完整的保存加载闭环。
image: "../../assets/images/yanami/cover-glasses.jpg"
---

# DeepStudy 源码解析：三层卷积 CNN 的标准训练范式

[DeepStudy](https://github.com/Melusine-ichnose/DeepStudy) 是一个 PyTorch 手写数字识别项目：用三层卷积网络在 MNIST 上做 0–9 分类，官方 README 写明 5 轮训练后测试集准确率约 99%。整个仓库只有两个 Python 文件——`SY8.py` 负责模型定义、训练、评估、保存，`test.py` 负责加载、推理、可视化，加起来不到两百行。

但读下来你会发现，这两百行把深度学习训练的完整闭环都走了一遍：**定义 → 训练 → 评估 → 保存 → 加载 → 推理 → 可视化**。麻雀虽小，五脏俱全。这篇笔记记录我认为值得展开的几个点。

## 项目结构：一个文件训练，一个文件推理

仓库结构非常干净（来自 [README.md](https://github.com/Melusine-ichnose/DeepStudy/blob/main/README.md)）：

```text
DeepStudy/
├── SY8.py     # 定义 CNN 模型，完成训练、评估、模型保存与样例可视化
├── test.py    # 加载已训练模型，对测试集图像进行预测并以 3×3 网格展示
└── README.md
```

训练和推理拆成两个文件，但模型定义只有一份——`test.py` 通过 `from DeepStudy.SY8 import CNN` 直接导入，而不是复制一份过来。这个选择后面再展开，先看模型本身。

## 网络定义：为 28×28 量身定制的尺寸推导

模型定义在 [SY8.py](https://github.com/Melusine-ichnose/DeepStudy/blob/main/DeepStudy/SY8.py)：

```python
class CNN(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = torch.nn.Conv2d(1, 32, kernel_size=3, stride=1, padding=1)
        self.conv2 = torch.nn.Conv2d(32, 64, kernel_size=3, stride=1, padding=1)
        self.conv3 = torch.nn.Conv2d(64, 128, kernel_size=3, stride=1, padding=1)
        self.fc1 = torch.nn.Linear(128 * 3 * 3, 128)
        self.fc2 = torch.nn.Linear(128, 10)
        self.pool = torch.nn.MaxPool2d(2, 2)
        self.dropout = torch.nn.Dropout(0.5)

    def forward(self, x):
        x = torch.nn.functional.relu(self.conv1(x))
        x = self.pool(x)
        x = torch.nn.functional.relu(self.conv2(x))
        x = self.pool(x)
        x = torch.nn.functional.relu(self.conv3(x))
        x = self.pool(x)
        x = x.view(-1, 128 * 3 * 3)
        x = torch.nn.functional.relu(self.fc1(x))
        x = self.dropout(x)
        x = torch.nn.functional.log_softmax(self.fc2(x), dim=1)
        return x
```

三个卷积层完全同构：3×3 卷积、stride=1、padding=1，也就是说**卷积只换通道数、不动空间尺寸**，尺寸全靠后面的 MaxPool2d(2, 2) 减半。于是空间维度的演化是一条确定的直线：

```text
28×28 → pool → 14×14 → pool → 7×7 → pool → 3×3（向下取整）
```

理解了这条线，`x.view(-1, 128 * 3 * 3)` 里的 `3 * 3` 就不是魔法数字，而是 28 连续三次减半（下取整）的结果。代价是这个网络是**为 MNIST 硬编码的**——输入一变，flatten 处直接 shape mismatch。对一个专攻 MNIST 的教学项目来说，这种取舍完全合理，但如果你要把它迁移到别的数据集，这三处地方（三个 conv 通道数、fc1 的输入维度、view 的参数）得连着改。

另一个细节：Dropout(0.5) 只放在 fc1 之后，三个卷积层一个都没加。这是教科书做法——卷积层的参数在感受野内共享，本身自带正则化，而过参数化最严重的全连接层才是过拟合的重灾区，dropout 该花在刀刃上。

## log_softmax + NLLLoss：一对老搭档

`forward` 的最后一层是 `log_softmax(self.fc2(x), dim=1)`，而 main 函数里配的损失函数是：

```python
#负对数似然损失函数
criterion = torch.nn.NLLLoss()
```

这两个必须成对出现：log_softmax 输出的是**对数概率**，NLLLoss 做的事情只有一个——取出真实类别对应的那个 log 概率，取负。合起来正好是交叉熵。

初学者常见的疑惑是：为什么不直接 Softmax + CrossEntropyLoss？因为 PyTorch 的 `CrossEntropyLoss` 内部本来就是 `log_softmax + NLLLoss` 的合体，如果先手动 Softmax 再喂 CrossEntropyLoss，等于 softmax 算了两遍，而且第一遍没有 log-sum-exp 的数值保护，大 logits 下容易溢出。这里的写法是"分开放"的流派：网络自己保证输出语义是 log 概率，损失函数只管挑类别。两种流派都对，唯独"Softmax + CrossEntropyLoss"这个直觉组合是错的。

## 训练循环：教科书五步，一个都不能少

主训练循环同样在 [SY8.py](https://github.com/Melusine-ichnose/DeepStudy/blob/main/DeepStudy/SY8.py)：

```python
for epoch in range(5):
    running_loss = 0.0
    for i, (x, y) in enumerate(train_data):
        optimizer.zero_grad()
        output = net.forward(x)
        loss = criterion(output, y)
        loss.backward()
        optimizer.step()
        running_loss += loss.item()
        if i % 200 == 199:
            print(f"[{epoch + 1}, {i + 1}] 损失: {running_loss / 200:.3f}")
            running_loss = 0.0

    accuracy = evaluate(test_data, net)
    print(f"第 {epoch + 1} 轮准确率: {accuracy * 100:.2f}%")
```

`zero_grad → forward → loss → backward → step` 这五步是 PyTorch 训练的骨架，其中最容易被初学者漏掉的是第一步。PyTorch 的梯度默认**累积**：`loss.backward()` 是往参数的 `.grad` 上做加法，不清零的话，上一个 batch 的梯度会叠加进这个 batch，等于在用一个脏梯度更新参数。这个坑几乎人人踩过，这里写对了。

日志节奏也处理得克制：不是每个 batch 都打印，而是攒够 200 个 batch 打一次平均损失，然后把 `running_loss` 清零重新累计。每 200 个 batch 一次、每个 epoch 结束评一次准确率——信息密度刚好够观察训练是否收敛，又不至于刷屏。

优化器与学习率没什么花哨的：

```python
optimizer = torch.optim.Adam(net.parameters(), lr=0.001)
```

## evaluate：朴素但正确的评估

```python
def evaluate(test_data, net):
    n_correct = 0
    n_total = 0
    with torch.no_grad():
        for (x, y) in test_data:
            outputs = net.forward(x)
            for i, output in enumerate(outputs):
                if torch.argmax(output) == y[i]:
                    n_correct += 1
                n_total += 1
    return n_correct / n_total
```

两个值得说的点：

1. **`torch.no_grad()` 包住了整个循环。** 评估不需要梯度，关掉自动求导的图构建能省显存、提速。评估函数忘写 no_grad 是另一个经典失误，尤其配合 `retain_graph` 相关的显存爆掉问题。
2. **逐样本的 Python 循环很朴素。** 每个输出挨个 `argmax` 再比较，其实一行向量化就能干完：`(outputs.argmax(dim=1) == y).sum().item()`。MNIST 上无所谓，但这是从"能跑"到"会写"的分界线，值得留意。

比实现本身更有意思的是 main 里的这个调用位置：

```python
print("初始准确率:", evaluate(test_data, net))
```

训练还没开始，先评估一次随机初始化的网络。在 MNIST 十分类上，随机网络准确率应该在 10% 附近——正好是瞎猜的水平。这个 baseline 一举两得：既验证了评估函数没有 bug（如果初始准确率明显不是 10%，多半是评估或数据加载出了问题），又给后面每轮的 99% 一个"从哪爬上来的"参照。很小的习惯，但反映出的工程意识不小时。

## test.py：推理侧的三个细节

推理脚本 [test.py](https://github.com/Melusine-ichnose/DeepStudy/blob/main/DeepStudy/test.py) 不长，但每一步都踩在正确的点上：

```python
def load_model(model_path):
    model = CNN()
    model.load_state_dict(torch.load(model_path))
    model.eval()
    return model

#预测单张图像
def predict_single_image(model, image_tensor):
    with torch.no_grad():
        output = model(image_tensor.unsqueeze(0))
        prediction = torch.argmax(output).item()
    return prediction
```

**细节一：state_dict 保存与加载。** 训练脚本结束时用的是 `torch.save(net.state_dict(), 'mnist_cnn.pth')`——只保存参数张量，不 pickle 整个模型对象。这带来了推理侧的一个必然结果：必须先实例化一个同结构的 `CNN()`，再把权重灌进去。这是 PyTorch 官方推荐的保存方式，比 pickle 整个对象更可移植（不依赖源码路径和类定义的 pickle 兼容性）。副作用是模型定义必须单点维护，于是 `test.py` 用 `from DeepStudy.SY8 import CNN` 导入——定义只有一份，保存和加载永远不会漂移。

**细节二：`model.eval()` 不可省。** 训练时 Dropout(0.5) 会随机置零一半的激活，推理时如果忘了 `eval()`，dropout 还在随机丢，预测结果就是随机化的——99% 的准确率会瞬间掉到不可用的水平。这个 bug 不报错、能跑完，只是结果莫名变差，属于最阴险的一类。这里写对了。

**细节三：`unsqueeze(0)` 补 batch 维。** 从数据集里取出的单张图是 `(1, 28, 28)` 三维张量，而 `Conv2d` 只接受 `(batch, channel, h, w)` 四维输入，所以推理前要 `unsqueeze(0)` 补上 batch 维变成 `(1, 1, 28, 28)`。单样本推理和批量的维度差异，是写推理代码时最常见的报错来源。

顺带一提，README 专门写了这个项目必须这样运行：

```bash
# 在 DeepStudy 的父目录中执行
python -m DeepStudy.test
```

原因正是上面的包导入：`from DeepStudy.SY8 import CNN` 是包导入语法，直接在仓库目录里 `python test.py` 会 import 失败，必须从父目录以模块方式跑。README 把这个坑提前写清楚了，省了后来者一次报错。

## 值得学习的地方

读完整仓源码，我认为有四点值得带走：

1. **闭环完整。** 不到两百行，训练、评估、保存、加载、推理、可视化全都有，而且职责边界清楚：`SY8.py` 只管"从数据到权重"，`test.py` 只管"从权重到预测"。入门项目最怕只写训练不写推理，权重存下来就没人管了。
2. **Baseline 意识。** 训练前先测一次随机准确率，10% 的数字同时验证了评估函数和数据管线。以后写任何训练脚本，我都建议保留这一行。
3. **组合拳用得规范。** log_softmax + NLLLoss、dropout 只放全连接层、state_dict 保存、eval() 切推理模式——这些不是炫技点，而是保证结果可复现、推理不翻车的地基。
4. **把坑写在文档里。** `python -m` 的运行方式、初始准确率预期、每轮准确率预期，README 都提前交代了。代码短，文档不糊弄。

作为 MNIST 级别的入门项目，DeepStudy 没有任何多余的东西，也没有缺关键的东西——这大概就是对"标准训练范式"四个字最好的注解。

项目地址：[github.com/Melusine-ichnose/DeepStudy](https://github.com/Melusine-ichnose/DeepStudy)
