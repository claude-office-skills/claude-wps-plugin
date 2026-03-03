---
name: local-access
description: macOS 本地计算机操作 — 日历、通讯录、邮件、提醒、Finder、剪贴板、浏览器、应用控制
version: 1.0.0
tags: [local, macos, calendar, contacts, mail, reminders, finder, clipboard, browser, apps, system]
modes: [agent]
context:
  keywords: [日历, 日程, 事件, 会议, 通讯录, 联系人, 邮件, 发邮件, 未读邮件, 提醒, 提醒事项, Finder, 文件夹, 剪贴板, 复制, 粘贴, 浏览器, 标签页, 打开网页, 应用, 启动, 退出, 系统信息, 本地, calendar, contacts, mail, reminders, clipboard, browser, apps, 电池, 磁盘]
---

## 本地计算机操作

你可以通过 local.* 操作访问用户的 macOS 系统应用。

### 使用方式

输出 JSON 指令，格式：
```json
{"_action": "local.calendar.list", "_args": [{"days": 7}]}
```

注意：_args 传入数组，第一个元素是参数对象。

### 可用操作速查

**日历**：local.calendar.list 查看事件、local.calendar.create 创建事件
**通讯录**：local.contacts.search 搜索联系人
**邮件**：local.mail.send 发送邮件、local.mail.unread 查看未读
**提醒**：local.reminders.list 查看、local.reminders.create 创建
**文件**：local.finder.open 打开目录、local.finder.selection 获取选中文件
**剪贴板**：local.clipboard.get 读取、local.clipboard.set 写入
**浏览器**：local.browser.tabs 查看标签页、local.browser.open 打开网址
**应用**：local.apps.list 列表、local.apps.launch 启动、local.apps.quit 退出
**系统**：local.system.info 获取主机名、用户、电池、磁盘信息

### Reasoning

当用户请求涉及本地系统应用时：
1. 识别需要哪个 local.* 操作
2. 输出对应 JSON 指令
3. 如果权限不足，系统会返回引导信息，转告用户需要在系统设置中授权
4. 操作成功后，用自然语言总结结果

### 常见场景

- 查查我本地日历 -> local.calendar.list
- 帮我发一封邮件 -> local.mail.send
- 搜索联系人张三 -> local.contacts.search
- 帮我创建一个提醒 -> local.reminders.create
- 打开 Downloads 文件夹 -> local.finder.open
- 我剪贴板里有什么 -> local.clipboard.get
- 查看浏览器标签页 -> local.browser.tabs
