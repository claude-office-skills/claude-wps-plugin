import { test, expect } from "@playwright/test";

test.describe("Finance Data API — 真实用户数据场景", () => {
  test.describe("美股数据", () => {
    test("GET /finance-data/AAPL 返回苹果公司完整财务数据", async ({
      request,
    }) => {
      const res = await request.get("/finance-data/AAPL");

      expect(res.ok()).toBeTruthy();

      const data = await res.json();
      expect(data.ticker).toBe("AAPL");
      expect(data.fetchedAt).toBeDefined();

      // summary 字段验证
      expect(data.summary).toBeDefined();
      expect(data.summary.shortName).toContain("Apple");
      expect(data.summary.currency).toBe("USD");
      expect(data.summary.currentPrice).toBeGreaterThan(0);
      expect(data.summary.totalRevenue).toBeGreaterThan(0);

      // 关键财务比率
      expect(data.keyStats).toBeDefined();
      expect(data.keyStats.trailingPE).toBeGreaterThan(0);
      expect(data.keyStats.marketCap).toBeGreaterThan(0);
    });

    test("AAPL 包含损益表数据", async ({ request }) => {
      const res = await request.get("/finance-data/AAPL");
      const data = await res.json();

      expect(data.incomeStatements).toBeInstanceOf(Array);
      expect(data.incomeStatements.length).toBeGreaterThan(0);

      const latest = data.incomeStatements[0];
      expect(latest.endDate).toBeDefined();
      expect(latest.totalRevenue).toBeGreaterThan(0);
    });

    test("AAPL 包含资产负债表", async ({ request }) => {
      const res = await request.get("/finance-data/AAPL");
      const data = await res.json();

      expect(data.balanceSheets).toBeInstanceOf(Array);
      expect(data.balanceSheets.length).toBeGreaterThan(0);
    });

    test("AAPL 包含现金流量表", async ({ request }) => {
      const res = await request.get("/finance-data/AAPL");
      const data = await res.json();

      expect(data.cashFlows).toBeInstanceOf(Array);
      expect(data.cashFlows.length).toBeGreaterThan(0);
    });
  });

  test.describe("A股数据", () => {
    test("GET /finance-data/601899.SS 返回紫金矿业数据", async ({
      request,
    }) => {
      const res = await request.get("/finance-data/601899.SS");

      expect(res.ok()).toBeTruthy();

      const data = await res.json();
      expect(data.ticker).toBe("601899.SS");
      expect(data.summary).toBeDefined();
      expect(data.summary.currency).toBe("CNY");
      expect(data.summary.currentPrice).toBeGreaterThan(0);
    });
  });

  test.describe("缓存机制", () => {
    test("第二次请求命中缓存（_cached: true）", async ({ request }) => {
      // 第一次请求
      await request.get("/finance-data/MSFT");

      // 第二次请求应命中缓存
      const res2 = await request.get("/finance-data/MSFT");
      const data2 = await res2.json();

      expect(data2._cached).toBe(true);
      expect(data2.ticker).toBe("MSFT");
    });
  });

  test.describe("价格数据", () => {
    test("GET /finance-data/AAPL/price 返回历史价格", async ({ request }) => {
      const res = await request.get("/finance-data/AAPL/price");

      expect(res.ok()).toBeTruthy();

      const data = await res.json();
      expect(data.ticker).toBe("AAPL");
      expect(data.count).toBeGreaterThan(0);
      expect(data.prices).toBeInstanceOf(Array);

      const price = data.prices[0];
      expect(price.date).toBeDefined();
      expect(price.open).toBeGreaterThan(0);
      expect(price.high).toBeGreaterThan(0);
      expect(price.low).toBeGreaterThan(0);
      expect(price.close).toBeGreaterThan(0);
      expect(price.volume).toBeGreaterThan(0);
    });

    test("自定义 range 和 interval", async ({ request }) => {
      const res = await request.get(
        "/finance-data/AAPL/price?range=6mo&interval=1wk",
      );

      expect(res.ok()).toBeTruthy();

      const data = await res.json();
      expect(data.count).toBeGreaterThan(0);
      expect(data.count).toBeLessThan(200);
    });
  });

  test.describe("错误处理", () => {
    test("无效 ticker 返回 404 或错误", async ({ request }) => {
      const res = await request.get("/finance-data/INVALID_TICKER_XYZ123");

      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });
});
