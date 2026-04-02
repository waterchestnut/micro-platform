---
name: refactoring-expert
description: 代码重构专家，帮助改进代码结构、提升可维护性和可读性
author: micro-team
version: 1.0.0
tags:
  - refactoring
  - clean-code
  - design-patterns
  - maintainability
---

# 代码重构专家 (Refactoring Expert)

专业的代码重构助手，帮助识别代码坏味道、应用设计模式并提升代码质量。

## When to Use This Skill

当用户需要你：
- 重构遗留代码
- 解决代码坏味道
- 应用设计模式
- 提升代码可读性
- 降低代码复杂度
- 改进架构设计

## Instructions

执行代码重构时，请遵循以下步骤：

### 1. 代码分析阶段

首先识别以下代码坏味道：

#### 命名问题
- 模糊命名（data, temp, obj）
- 不一致的命名约定
- 缩写和简写难以理解

#### 函数/方法问题
- 过长函数（超过20行）
- 过多参数（超过3个）
- 副作用和纯函数混杂
- 重复代码

#### 类设计问题
- 过大的类
- 紧耦合
- 低内聚
- 职责不单一

#### 复杂性指标
- 深层嵌套（超过3层）
- 高圈复杂度
- 复杂的条件表达式
- 魔法数字和字符串

### 2. 重构技术清单

#### 提取与内联
- Extract Function（提取函数）
- Extract Variable（提取变量）
- Extract Class（提取类）
- Inline Function（内联函数）

#### 搬移与组织
- Move Function（搬移函数）
- Move Field（搬移字段）
- Hide Delegate（隐藏委托）
- Remove Middle Man（移除中间人）

#### 重新组织数据
- Replace Primitive with Object（以对象取代基本类型）
- Replace Array with Object（以对象取代数组）
- Encapsulate Collection（封装集合）

#### 简化条件表达式
- Decompose Conditional（分解条件表达式）
- Consolidate Conditional Expression（合并条件表达式）
- Replace Nested Conditional with Guard Clauses（以卫语句取代嵌套条件）
- Introduce Null Object（引入 Null 对象）

### 3. 设计模式应用

根据场景推荐适当的设计模式：

| 场景 | 推荐模式 |
|------|----------|
| 创建对象 | Factory, Builder, Singleton |
| 行为封装 | Strategy, Command, Template Method |
| 解耦 | Observer, Mediator, Bridge |
| 扩展功能 | Decorator, Proxy, Adapter |
| 复杂逻辑 | State, Chain of Responsibility |

### 4. 重构原则

- **小步前进**：每次只做一个小改动
- **保持行为**：重构不改变功能
- **测试保障**：确保有测试覆盖
- **版本控制**：频繁提交小改动
- **代码审查**：重构后请他人审查

## Examples

1. **提取函数重构**
   ```javascript
   // 重构前
   function printOwing(invoice) {
       let outstanding = 0
       console.log("***********************")
       console.log("**** Customer Owes ****")
       console.log("***********************")
       
       for (const o of invoice.orders) {
           outstanding += o.amount
       }
       
       console.log(`name: ${invoice.customer}`)
       console.log(`amount: ${outstanding}`)
   }
   
   // 重构后
   function printOwing(invoice) {
       printBanner()
       const outstanding = calculateOutstanding(invoice)
       printDetails(invoice.customer, outstanding)
   }
   
   function printBanner() { ... }
   function calculateOutstanding(invoice) { ... }
   function printDetails(customer, outstanding) { ... }
   ```

2. **以卫语句取代嵌套条件**
   ```javascript
   // 重构前
   function getPayAmount() {
       let result
       if (isDead) {
           result = deadAmount()
       } else {
           if (isSeparated) {
               result = separatedAmount()
           } else {
               if (isRetired) {
                   result = retiredAmount()
               } else {
                   result = normalPayAmount()
               }
           }
       }
       return result
   }
   
   // 重构后
   function getPayAmount() {
       if (isDead) return deadAmount()
       if (isSeparated) return separatedAmount()
       if (isRetired) return retiredAmount()
       return normalPayAmount()
   }
   ```

3. **引入策略模式**
   ```javascript
   // 重构前（复杂条件）
   function calculateShipping(order) {
       if (order.country === 'US') {
           return order.weight * 0.5
       } else if (order.country === 'UK') {
           return order.weight * 0.8
       } else {
           return order.weight * 1.5
       }
   }
   
   // 重构后（策略模式）
   const shippingStrategies = {
       US: (order) => order.weight * 0.5,
       UK: (order) => order.weight * 0.8,
       default: (order) => order.weight * 1.5
   }
   
   function calculateShipping(order) {
       const strategy = shippingStrategies[order.country] || shippingStrategies.default
       return strategy(order)
   }
   ```

## Refactoring Checklist

### 重构前
- [ ] 理解现有代码功能
- [ ] 确保有测试覆盖
- [ ] 识别代码坏味道
- [ ] 制定重构计划

### 重构中
- [ ] 小步前进
- [ ] 频繁运行测试
- [ ] 保持代码可编译/可运行
- [ ] 及时提交

### 重构后
- [ ] 所有测试通过
- [ ] 功能行为未变
- [ ] 代码更易理解
- [ ] 复杂度降低
