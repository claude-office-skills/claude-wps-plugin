# 渠道配置说明 (v2.2.0)

渠道配置存储在用户本地，**不进 Git，不上传任何凭证**。

## 配置文件路径

```
~/.claude-wps/channels.json
```

## 配置示例

```json
{
  "feishu": {
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/your-token-here"
  },
  "email": {
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false
    },
    "user": "your-email@gmail.com",
    "passwordEnvVar": "CLAUDE_WPS_EMAIL_PASS",
    "from": "Claude for WPS <your-email@gmail.com>"
  },
  "webhook": {
    "url": "https://your-endpoint.com/notify",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

## 飞书配置

1. 飞书群 → 右上角设置 → 群机器人 → 添加机器人 → 自定义机器人
2. 复制 Webhook 地址填入 `feishu.webhookUrl`

## 邮件配置（Gmail 示例）

```bash
# 1. 生成 Gmail 应用专用密码（需先开启两步验证）
#    https://myaccount.google.com/apppasswords

# 2. 设置环境变量（加入 ~/.zshrc 或 ~/.bash_profile）
export CLAUDE_WPS_EMAIL_PASS="your-app-password"

# 3. 或使用 macOS Mail.app（无需密码）
#    config: { "mailApp": true }
```

## 测试渠道

```bash
# 测试飞书
curl -X POST http://127.0.0.1:3001/action/execute \
  -H "Content-Type: application/json" \
  -d '{"action":"notify.feishu","params":{"message":"测试消息"}}'

# 测试系统通知
curl -X POST http://127.0.0.1:3001/action/execute \
  -H "Content-Type: application/json" \
  -d '{"action":"system.notify","params":{"title":"测试","message":"Hello from Claude WPS!"}}'
```
