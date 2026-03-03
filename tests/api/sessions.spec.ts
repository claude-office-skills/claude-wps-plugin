import { test, expect } from "@playwright/test";

test.describe("Sessions API", () => {
  test("GET /sessions 返回会话列表", async ({ request }) => {
    const res = await request.get("/sessions");

    expect(res.ok()).toBeTruthy();

    const sessions = await res.json();
    expect(sessions).toBeInstanceOf(Array);
  });

  test("GET /wps-context 返回 WPS 上下文（或默认值）", async ({ request }) => {
    const res = await request.get("/wps-context");

    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    // 在非 WPS 环境下，应返回某种默认/空数据
    expect(data).toBeDefined();
  });
});
