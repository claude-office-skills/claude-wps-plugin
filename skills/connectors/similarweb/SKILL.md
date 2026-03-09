---
name: similarweb
type: connector
description: SimilarWeb 网站分析连接器 — 流量、排名、营销渠道、受众画像等数据
version: 1.0.0
modes: [agent, plan, ask]
context:
  keywords: [网站流量, 访问量, UV, PV, 跳出率, 排名, 流量来源, 营销渠道, 竞品分析, similarweb, 网站分析, 域名分析, SEO, 搜索流量, 独立访客, 网页浏览量]
---

## SimilarWeb 网站分析连接器

通过 `dataBridgePull()` 获取网站流量、排名、营销渠道等分析数据。

### 获取网站流量与互动

```javascript
var resp = dataBridgePull("similarweb", "traffic_engagement", {
  domain: "google.com",
  start_date: "2024-01",
  end_date: "2024-12",
  granularity: "monthly",
  country: "world"
});
if (!resp || !resp.ok) return "获取数据失败: " + (resp ? resp.error : "网络错误");
var d = resp.data;
// d 包含: visits, bounce_rate, average_visit_duration, pages_per_visit, unique_visitors
```

### 获取网站排名

```javascript
var resp = dataBridgePull("similarweb", "website_ranking", {
  domain: "google.com"
});
// 返回: 全球排名、国家排名、行业排名
```

### 获取流量来源

```javascript
var resp = dataBridgePull("similarweb", "traffic_sources", {
  domain: "google.com",
  start_date: "2024-01",
  end_date: "2024-12",
  country: "world"
});
// 各渠道（直接/搜索/社交/引荐/邮件/展示广告）的流量占比
```

### 获取流量地域分布

```javascript
var resp = dataBridgePull("similarweb", "traffic_geography", {
  domain: "google.com",
  start_date: "2024-01",
  end_date: "2024-12"
});
// 按国家的流量占比
```

### 获取应用详情

```javascript
var resp = dataBridgePull("similarweb", "app_details", {
  app_id: "com.google.android.gm",
  store: "google"
});
```

### 可用 Actions

| Action | 说明 | 必需参数 |
|--------|------|----------|
| `traffic_engagement` | 流量与互动 | domain, start_date, end_date |
| `website_ranking` | 网站排名 | domain |
| `traffic_sources` | 流量来源 | domain, start_date, end_date |
| `traffic_geography` | 流量地域分布 | domain, start_date, end_date |
| `app_details` | 应用详情 | app_id, store |

### 参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| domain | 网站域名（不含 www） | `"google.com"`, `"baidu.com"` |
| start_date | 开始月份 | `"2024-01"` |
| end_date | 结束月份 | `"2024-12"` |
| granularity | 时间粒度 | `"daily"` / `"weekly"` / `"monthly"` |
| country | 国家/地区 | `"world"`, `"us"`, `"cn"`, `"gb"` |
| store | 应用商店 | `"google"` / `"apple"` |

### 重要规则

- **日期格式 YYYY-MM**：SimilarWeb 使用月份粒度的日期（非 YYYY-MM-DD）
- **国家小写**：使用小写国家代码（`"us"` 而非 `"US"`），或 `"world"` 表示全球
- **域名不含协议**：传入 `"google.com"` 而非 `"https://www.google.com"`
- **检查 `resp.ok`**：必须检查返回状态
- **API 限流**：每秒最多 10 次请求，系统已内置缓存（1 小时 TTL）
