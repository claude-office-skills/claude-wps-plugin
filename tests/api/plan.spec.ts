import { test, expect } from "@playwright/test";

test.describe("Plan API (v2.3)", () => {
  const SESSION_ID = "test-plan-session-" + Date.now();

  test("POST /v2/plan/parse 解析 numbered steps", async ({ request }) => {
    const res = await request.post("/v2/plan/parse", {
      data: {
        content: "1. 获取数据\n2. 建立模型\n3. 输出结果",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.steps).toHaveLength(3);
    expect(data.steps[0].text).toBe("获取数据");
  });

  test("POST /v2/plan/parse 解析 checkbox 格式", async ({ request }) => {
    const res = await request.post("/v2/plan/parse", {
      data: {
        content: "- [ ] Step A\n- [x] Step B\n- [ ] Step C",
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.steps).toHaveLength(3);
    expect(data.steps[1].done).toBe(true);
  });

  test("POST /v2/plan/save + GET /v2/plan/status", async ({ request }) => {
    const saveRes = await request.post("/v2/plan/save", {
      data: {
        sessionId: SESSION_ID,
        steps: [
          { index: 1, text: "Step 1", done: false },
          { index: 2, text: "Step 2", done: false },
        ],
        currentStep: 0,
      },
    });
    expect(saveRes.ok()).toBeTruthy();

    const statusRes = await request.get(`/v2/plan/status/${SESSION_ID}`);
    expect(statusRes.ok()).toBeTruthy();
    const data = await statusRes.json();
    expect(data.steps).toHaveLength(2);
    expect(data.status).toBe("idle");
  });

  test("POST /v2/plan/skip-step 跳过步骤", async ({ request }) => {
    await request.post("/v2/plan/save", {
      data: {
        sessionId: SESSION_ID,
        steps: [
          { index: 1, text: "Skip me", done: false, status: "pending" },
          { index: 2, text: "Keep me", done: false, status: "pending" },
        ],
      },
    });

    const res = await request.post("/v2/plan/skip-step", {
      data: { sessionId: SESSION_ID, stepIndex: 1 },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.step.status).toBe("skipped");
  });

  test("GET /v2/plan/status 404 for unknown session", async ({ request }) => {
    const res = await request.get("/v2/plan/status/nonexistent-session-id");
    expect(res.status()).toBe(404);
  });

  test("POST /v2/plan/execute-step 无代码直接标记成功", async ({ request }) => {
    const sid = "plan-exec-test-" + Date.now();
    await request.post("/v2/plan/save", {
      data: {
        sessionId: sid,
        steps: [{ index: 1, text: "Manual step", done: false, status: "pending" }],
      },
    });

    const res = await request.post("/v2/plan/execute-step", {
      data: { sessionId: sid, stepIndex: 1 },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.step.status).toBe("success");
    expect(data.step.done).toBe(true);
  });
});
