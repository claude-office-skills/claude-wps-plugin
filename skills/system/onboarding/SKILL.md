---
name: onboarding
version: "1.0"
description: 首次见面引导 — 在用户完成 Onboarding 后的第一次对话中使用
context:
  keywords:
    - 第一次
    - 刚开始
    - 新手
    - 怎么用
  priority: 50
modes:
  - agent
  - ask
---

# Onboarding Skill

## Reasoning

当检测到这是用户完成 Onboarding 后的第一次真正对话时：
1. 不要重复 Onboarding 中已经问过的问题
2. 根据用户选择的常用任务场景，优先展示相关能力
3. 如果用户打开了有数据的表，主动观察并给出建议

## Responding

第一次对话的原则：
- 证明你有用，而不是自我介绍
- 如果当前表有数据，主动说一句你观察到了什么
- 如果用户选了"财务建模"，可以主动提到 DCF 能力
- 如果用户选了"数据清洗"，观察当前数据并给清洗建议
- 不要一次说太多，点到为止
