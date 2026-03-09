---
name: sensortower
type: connector
description: SensorTower 移动应用数据连接器 — App 下载量、收入、DAU/MAU 数据
version: 1.0.0
modes: [agent, plan, ask]
context:
  keywords: [下载量, 收入, DAU, MAU, 活跃用户, App Store, Google Play, 应用商店, 移动应用, sensortower, sensor tower, iOS, Android, 手游, 应用排行, 应用收入, 应用下载]
---

## SensorTower 移动应用数据连接器

通过 `dataBridgePull()` 获取移动应用下载量、收入、活跃用户等数据。

### 获取应用下载与收入

```javascript
var resp = dataBridgePull("sensortower", "app_sales", {
  os: "ios",
  app_id: "553834731",
  countries: "US,GB",
  start_date: "2024-01-01",
  end_date: "2024-12-31",
  date_granularity: "monthly"
});
if (!resp || !resp.ok) return "获取数据失败: " + (resp ? resp.error : "网络错误");
var records = resp.data.records;
// iOS: [{date, country, appId, iphoneDownloads, ipadDownloads, totalDownloads, iphoneRevenue, ipadRevenue, totalRevenue}, ...]
// Android: [{date, country, appId, downloads, revenue}, ...]
```

### 获取活跃用户 (DAU/MAU)

```javascript
var resp = dataBridgePull("sensortower", "app_active_users", {
  os: "ios",
  app_id: "553834731",
  countries: "US",
  start_date: "2024-01-01",
  end_date: "2024-12-31",
  date_granularity: "monthly",
  metric: "dau"
});
var records = resp.data.records; // [{date, country, appId, dau}, ...]
```

### 参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| os | 平台 | `"ios"` 或 `"android"` |
| app_id | 应用 ID | iOS 数字 ID: `"553834731"`, Android 包名: `"com.king.candycrushsaga"` |
| countries | 国家代码 | `"US"`, `"US,GB,JP"`, `"WW"`(全球) |
| start_date | 开始日期 | `"2024-01-01"` |
| end_date | 结束日期 | `"2024-12-31"` |
| date_granularity | 时间粒度 | `"daily"` / `"weekly"` / `"monthly"` / `"quarterly"` |
| metric | 活跃用户指标 | `"dau"` / `"mau"` |

### 重要规则

- **收入单位**：返回值已转为美元（API 原始返回美分，handler 已做 ÷100 处理）
- **日期分段**：API 有超时限制，handler 自动按粒度分段请求，无需手动处理
- **iOS 区分设备**：iOS 数据包含 iPhone 和 iPad 分别的下载/收入，以及合计
- **检查 `resp.ok`**：必须检查返回状态
