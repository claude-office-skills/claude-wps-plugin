import { test, expect } from "@playwright/test";

test.describe("User Skills API (v2.3)", () => {
  const SKILL_NAME = "test-skill-" + Date.now();
  const SKILL_CONTENT = `---
name: ${SKILL_NAME}
description: "A test skill"
version: "1.0.0"
minSystemVersion: "2.3.0"
tags: ["test"]
---

# Test Skill

This is a test skill.
`;

  test("GET /v2/user-skills 返回列表", async ({ request }) => {
    const res = await request.get("/v2/user-skills");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.skills).toBeInstanceOf(Array);
    expect(data.conflicts).toBeInstanceOf(Array);
  });

  test("POST /v2/user-skills/create 创建技能", async ({ request }) => {
    const res = await request.post("/v2/user-skills/create", {
      data: { name: SKILL_NAME, content: SKILL_CONTENT },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.name).toBe(SKILL_NAME);
  });

  test("GET /v2/user-skills/:name 读取已创建技能", async ({ request }) => {
    const res = await request.get(`/v2/user-skills/${SKILL_NAME}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.name).toBe(SKILL_NAME);
    expect(data.raw).toContain("# Test Skill");
  });

  test("PUT /v2/user-skills/:name 更新技能", async ({ request }) => {
    const updatedContent = SKILL_CONTENT.replace("A test skill", "Updated skill");
    const res = await request.put(`/v2/user-skills/${SKILL_NAME}`, {
      data: { content: updatedContent },
    });
    expect(res.ok()).toBeTruthy();

    const readRes = await request.get(`/v2/user-skills/${SKILL_NAME}`);
    const data = await readRes.json();
    expect(data.raw).toContain("Updated skill");
  });

  test("GET /v2/user-skills/:name/diff 获取 Diff", async ({ request }) => {
    const res = await request.get(`/v2/user-skills/${SKILL_NAME}/diff`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.name).toBe(SKILL_NAME);
    expect(data.userContent).toBeTruthy();
    expect(data.hasSystemVersion).toBe(false);
  });

  test("POST /v2/user-skills/create 重复名称返回 409", async ({ request }) => {
    const res = await request.post("/v2/user-skills/create", {
      data: { name: SKILL_NAME, content: SKILL_CONTENT },
    });
    expect(res.status()).toBe(409);
  });

  test("DELETE /v2/user-skills/:name 删除技能", async ({ request }) => {
    const res = await request.delete(`/v2/user-skills/${SKILL_NAME}`);
    expect(res.ok()).toBeTruthy();

    const readRes = await request.get(`/v2/user-skills/${SKILL_NAME}`);
    expect(readRes.status()).toBe(404);
  });

  test("GET /v2/skills/merged 返回合并后全部技能", async ({ request }) => {
    const res = await request.get("/v2/skills/merged");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.skills).toBeInstanceOf(Array);
    expect(data.total).toBeGreaterThan(0);
  });

  test("GET /v2/user-skills/compatibility 返回兼容性检查", async ({ request }) => {
    const res = await request.get("/v2/user-skills/compatibility");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.systemVersion).toBeDefined();
    expect(data.warnings).toBeInstanceOf(Array);
    expect(data.conflicts).toBeInstanceOf(Array);
  });

  test("POST /v2/user-skills/generate-preview 生成预览", async ({ request }) => {
    const res = await request.post("/v2/user-skills/generate-preview", {
      data: { intent: "help me clean data" },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.meta).toBeDefined();
    expect(data.content).toContain("---");
    expect(data.validation).toBeDefined();
  });
});
