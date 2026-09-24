---
title: 多商户商城系统源码解析：一笔订单背后的拆单、渲染与兜底
published: 2026-09-24
tags: [源码解析, SpringBoot, Java]
category: 源码解析
draft: false
slug: mall-source-analysis
description: 深入一个 B2B2C 多商户商城的 Java 源码，拆解交易-订单两级拆单、购物车渲染流水线、定时兜底与商家端数据隔离四个核心设计。
image: "../../assets/images/yanami/cover-smile.jpg"
---

# 多商户商城系统源码解析：一笔订单背后的拆单、渲染与兜底

[Multi-merchant-Mall-System](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System) 是一个 B2B2C 多商户商城系统的后端仓库：Java + Spring Boot，九个后端模块、一千五百多个源文件，消息队列用 RocketMQ，搜索用 Elasticsearch，定时任务用 XXL-Job。翻代码的时候能明显看出这套代码与开源项目 lilishop 同源——包名是 `cn.lili`，类注释里的署名是 Chopper、paulG 这些 lilishop 的作者。这篇文章不管归属，就把它当成一份完整的 B2B2C 教材，记录我读源码时认为最值得学的几个设计。

## 一、模块划分：一个角色一个 API 服务

先看顶层结构。仓库不是单体大杂烩，而是按角色切了模块：

```text
admin          独立的管理端启动器
buyer-api      买家端接口
seller-api     商家端接口
manager-api    平台运营端接口
common-api     公共接口
consumer       消息消费者 + 定时任务
framework      实体、服务层等公共业务代码
im-api         即时通讯
xxl-job        分布式调度
```

业务代码几乎全下沉在 `framework` 里，三个 API 模块只是薄薄的 Controller 层。买家、商家、平台三个角色各走各的服务，物理上就隔离开了——商家端被打穿不会波及买家端。这个拆法在商城这类多角色系统里非常实用。

## 二、多商户的根基：Trade → Order 两级拆单

多商户商城和普通商城最本质的区别是：**一次下单可能跨多个店铺，必须按店铺拆单**。这套代码的建模方式是"交易（Trade）- 订单（Order）"两级结构。

`TradeDTO`（贯穿下单流程的视图对象）里有两条线索。一个是平台券和店铺券分开建模（来自 [TradeDTO.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/cart/entity/dto/TradeDTO.java)）：

```java
/**
 * 使用平台优惠券，一笔订单只能使用一个平台优惠券
 */
private MemberCouponDTO platformCoupon;

/**
 * key 为商家id
 * value 为商家优惠券
 * 店铺优惠券
 */
private Map<String, MemberCouponDTO> storeCoupons;
```

平台券一张订单只能用一张，店铺券按商家 ID 分组、每个店铺各用各的——优惠券体系从数据结构上就按"平台/商户"分了层。

拆单发生在购物车阶段：购物车里每个 `CartVO` 就是一个店铺的商品集合，下单时一个 `CartVO` 生成一个 `Order`。所以 `Order` 实体里直接冗余了店铺字段（来自 [Order.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/order/entity/dos/Order.java)）：

```java
@ApiModelProperty("交易编号 关联Trade")
private String tradeSn;

@ApiModelProperty(value = "店铺ID")
private String storeId;

@ApiModelProperty(value = "店铺名称")
private String storeName;
```

入库的实现在 [OrderServiceImpl.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/order/serviceimpl/OrderServiceImpl.java) 的 `intoDB`，整个方法包在一个事务里：

```java
@Override
@Transactional(rollbackFor = Exception.class)
public void intoDB(TradeDTO tradeDTO) {
    //检查TradeDTO信息
    checkTradeDTO(tradeDTO);
    //存放购物车，即业务中的订单
    List<Order> orders = new ArrayList<>(tradeDTO.getCartList().size());
    //存放自订单/订单日志
    List<OrderItem> orderItems = new ArrayList<>();
    List<OrderLog> orderLogs = new ArrayList<>();

    //循环购物车
    tradeDTO.getCartList().forEach(item -> {
        Order order = new Order(item, tradeDTO);
        orders.add(order);
        ...
    });
    //批量保存订单
    this.saveBatch(orders);
    //批量保存 子订单
    orderItemService.saveBatch(orderItems);
    //批量记录订单操作日志
    orderLogService.saveBatch(orderLogs);
}
```

而支付是按交易维度进行的，[TradeServiceImpl.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/order/serviceimpl/TradeServiceImpl.java) 的 `payTrade` 把一笔交易下的所有订单逐个推进支付流程：

```java
@Override
@Transactional(rollbackFor = Exception.class)
public void payTrade(String tradeSn, String paymentName, String receivableNo) {
    LambdaQueryWrapper<Order> orderQueryWrapper = new LambdaQueryWrapper<>();
    orderQueryWrapper.eq(Order::getTradeSn, tradeSn);
    List<Order> orders = orderService.list(orderQueryWrapper);
    for (Order order : orders) {
        orderService.payOrder(order.getSn(), paymentName, receivableNo);
    }
    ...
}
```

用户付一次钱，N 个店铺的订单各自流转各自的发货、售后。这就是 B2B2C 的"一次支付、拆单履约"。

## 三、价格计算：可编排的渲染流水线

价格计算是商城里最乱的部分——商品促销、满减、优惠券、运费、佣金层层叠加，还要区分购物车展示、结算页、各种营销下单等不同场景。这套代码的解法我特别喜欢：**把每一步计算做成一个 Bean，用数组声明流水线的顺序**。

先定义步骤接口（[CartRenderStep.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/cart/render/CartRenderStep.java)）：

```java
public interface CartRenderStep {

    RenderStepEnums step();

    void render(TradeDTO tradeDTO);
}
```

然后每种场景声明自己的步骤组合（[RenderStepStatement.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/cart/render/RenderStepStatement.java)）：

```java
/**
 * 交易创建前渲染
 * 渲染购物车 生成SN 》分销人员佣金渲染 》平台佣金渲染
 */
public static RenderStepEnums[] tradeRender = {
        RenderStepEnums.CHECKED_FILTER,
        RenderStepEnums.CHECK_DATA,
        RenderStepEnums.SKU_PROMOTION,
        RenderStepEnums.FULL_DISCOUNT,
        RenderStepEnums.COUPON,
        RenderStepEnums.SKU_FREIGHT,
        RenderStepEnums.CART_PRICE,
        RenderStepEnums.CART_SN,
        RenderStepEnums.DISTRIBUTION,
        RenderStepEnums.PLATFORM_COMMISSION
};
```

执行器是 [TradeBuilder.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/cart/render/TradeBuilder.java)，利用 Spring 把所有 `CartRenderStep` 实现类注入成列表，再按声明的顺序依次调用：

```java
private void renderCartBySteps(TradeDTO tradeDTO, RenderStepEnums[] defaultRender) {
    for (RenderStepEnums step : defaultRender) {
        for (CartRenderStep render : cartRenderSteps) {
            try {
                if (render.step().equals(step)) {
                    render.render(tradeDTO);
                }
            } catch (ServiceException e) {
                throw e;
            } catch (Exception e) {
                log.error("购物车{}渲染异常：", render.getClass(), e);
            }
        }
    }
}
```

不同场景复用不同流水线：购物车展示只要校验、促销、满减、算价四步；结算页要加上优惠券和运费；积分/砍价这类单品购买跳过满减；普通下单则要再追加流水号、分销佣金、平台佣金。新增一种营销玩法，写一个 `CartRenderStep` 实现类、往数组里插一个枚举就行，价格计算这个"重灾区"被治理得井井有条。

那段异常处理也值得品：`ServiceException` 是业务校验失败（比如商品已下架），必须中断下单直接抛出；而其他未知异常只记日志、继续渲染——展示购物车时一个非关键步骤挂掉不应该让整个购物车打不开。区分"必须失败的异常"和"可以带病运行的异常"，这是业务系统里很见功力的细节。

## 四、未支付订单的自动关闭：定时任务兜底

和上一篇座位预约系统一样，这套代码对"应该发生但用户没做"的事情也用了定时任务兜底。订单超时未支付要自动释放库存、关闭订单，实现在 [CancelOrderTaskExecute.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/consumer/src/main/java/cn/lili/timetask/handler/impl/order/CancelOrderTaskExecute.java)：

```java
@Override
public void execute() {
    Setting setting = settingService.get(SettingEnum.ORDER_SETTING.name());
    OrderSetting orderSetting = JSONUtil.toBean(setting.getSettingValue(), OrderSetting.class);
    if (orderSetting != null && orderSetting.getAutoCancel() != null) {
        //订单自动取消时间 = 当前时间 - 自动取消时间分钟数
        DateTime cancelTime = DateUtil.offsetMinute(DateUtil.date(), -orderSetting.getAutoCancel());
        LambdaQueryWrapper<Order> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Order::getOrderStatus, OrderStatusEnum.UNPAID.name());
        //订单创建时间 <= 订单自动取消时间
        queryWrapper.le(Order::getCreateTime, cancelTime);
        List<Order> list = orderService.list(queryWrapper);
        List<String> cancelSnList = list.stream().map(Order::getSn).collect(Collectors.toList());
        for (String sn : cancelSnList) {
            orderService.systemCancel(sn, "超时未支付自动取消", false);
        }
    }
}
```

三个细节：超时时长从系统设置表里读而不是写死在代码里，运营可以在后台调；查询条件是"状态 = UNPAID 且创建时间早于临界点"，扫描完逐单走统一的 `systemCancel` 流程（而不是直接改状态，保证取消副作用一致）；任务类实现 `EveryMinuteExecute` 接口，由 consumer 模块统一驱动。订单状态本身则收敛在 `OrderStatusEnum`：`UNPAID → PAID → UNDELIVERED → PARTS_DELIVERED → DELIVERED → COMPLETED`，外加待自提、待核验、已关闭，所有操作都翻译成状态流转。

## 五、下单事件：事务提交后再发消息

下单成功后的积分扣减、砍价收尾、消息通知这些周边动作，没有塞在下单事务里，而是走 RocketMQ 异步。这里有个容易踩坑的时序问题：**如果事务还没提交就把消息发出去，消费者可能读到不存在的数据**。

[TradeServiceImpl.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/framework/src/main/java/cn/lili/modules/order/order/serviceimpl/TradeServiceImpl.java) 的处理分两步。先把 `TradeDTO` 整体写进缓存，MQ 消息体只携带一个 key：

```java
//写入缓存，给消费者调用
cache.put(key, JSONUtil.toJsonStr(tradeDTO));
applicationEventPublisher.publishEvent(new TransactionCommitSendMQEvent("订单创建消息", rocketmqCustomProperties.getOrderTopic(),
        OrderTagsEnum.ORDER_CREATE.name(), key));
```

`TransactionCommitSendMQEvent` 借助 Spring 事件机制，把真正的 MQ 发送推迟到事务提交之后——避免"消息先到、数据未落库"。消费者端 [OrderMessageListener.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/consumer/src/main/java/cn/lili/listener/OrderMessageListener.java) 再从缓存取回完整数据：

```java
case ORDER_CREATE:
    String key = new String(messageExt.getBody());
    TradeDTO tradeDTO = JSONUtil.toBean(cache.getString(key), TradeDTO.class);
    boolean result = true;
    for (TradeEvent event : tradeEvent) {
        try {
            event.orderCreate(tradeDTO);
        } catch (Exception e) {
            log.error("交易{}入库,在{}业务中，状态修改事件执行异常", ...);
            result = false;
        }
    }
    //如所有步骤顺利完成
    if (Boolean.TRUE.equals(result)) {
        //清除记录信息的trade cache key
        cache.remove(key);
    }
    break;
```

注入的是 `List<TradeEvent>`——每个下游业务实现同一个事件接口，消费者遍历广播，谁都不依赖谁。任何一个业务失败就保留缓存 key 不删除，配合消息重试还能再跑一轮。订单状态变更（`STATUS_CHANGE`）同理广播给所有 `OrderStatusChangeEvent` 实现。

## 六、商家端的数据隔离：每个查询都带着 storeId

多商户系统最敏感的问题是越权：A 商家能不能改 B 商家的订单？这套代码的答案是把"判断归属"做成了惯用法。商家端控制器 [OrderStoreController.java](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System/blob/main/seller-api/src/main/java/cn/lili/controller/order/OrderStoreController.java) 里，凡是按订单号操作的地方都先过一道 `OperationalJudgment.judgment`：

```java
@GetMapping(value = "/{orderSn}")
public ResultMessage<OrderDetailVO> detail(@NotNull @PathVariable String orderSn) {
    OperationalJudgment.judgment(orderService.getBySn(orderSn));
    return ResultUtil.data(orderService.queryDetail(orderSn));
}
```

服务层内部则统一从 `UserContext` 取当前登录商家的店铺 ID 作为查询条件，比如核验自提订单：

```java
String storeId = Objects.requireNonNull(UserContext.getCurrentUser()).getStoreId();
Order order = this.getOne(new LambdaQueryWrapper<Order>()
        .in(Order::getOrderStatus, OrderStatusEnum.TAKE.name(), OrderStatusEnum.STAY_PICKED_UP.name())
        .eq(Order::getStoreId, storeId)
        .eq(Order::getVerificationCode, verificationCode));
```

没有做复杂的行级权限框架，就是最朴素的原则：**商家端所有查询都显式带 storeId 条件**。防重复提交则统一挂在方法注解上（`@PreventDuplicateSubmissions`），发货、改价、取消这些写操作全都加了一遍。

## 值得学习的地方

1. **按角色拆 API 服务，业务下沉 framework。** 多角色系统的天然切分线就是角色，物理隔离比一堆 if-else 判断身份可靠得多。
2. **Trade → Order 两级模型支撑拆单。** 平台券/店铺券分层、订单冗余店铺信息、支付按交易、履约按订单，"多商户"不是一个字段，而是一整套建模。
3. **渲染流水线治理价格计算。** 步骤即 Bean、顺序即数组，扩展营销玩法不改老代码；同时区分业务异常（中断）与系统异常（降级继续）。
4. **事务提交后再发消息 + 缓存中转大报文。** 消息只传 key，时序正确性和消息体大小两个问题一起解决。
5. **数据隔离靠纪律而不是框架。** 商家端每个查询显式带 storeId，归属校验做成 `OperationalJudgment` 这样的惯用法，简单但有效。

作为一个学习样本，它把 B2B2C 商城会遇到的典型问题——拆单、价格叠加、异步履约、越权防护——都给出了一种可参考的工程解法，值得通读一遍。

项目地址：[github.com/Melusine-ichnose/Multi-merchant-Mall-System](https://github.com/Melusine-ichnose/Multi-merchant-Mall-System)
