import { test, expect } from "@playwright/test";

test.describe("Health Check API", () => {
  test("GET /health 返回服务状态", async ({ request }) => {
    const res = await request.get("/health");

    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.version).toBeDefined();
    expect(data.skills).toBeGreaterThan(0);
    expect(data.skillNames).toBeInstanceOf(Array);
    expect(data.skillNames.length).toBeGreaterThan(0);
  });

  test("health 返回已加载的 features 列表", async ({ request }) => {
    const res = await request.get("/health");
    const data = await res.json();

    expect(data.features).toBeInstanceOf(Array);
    expect(data.features).toContain("finance-cache-1h");
    expect(data.features).toContain("skill-weight-scoring");
    expect(data.features).toContain("smart-context-sampling");
  });

  test("health 返回 modes 数量", async ({ request }) => {
    const res = await request.get("/health");
    const data = await res.json();

    expect(data.modes).toBeGreaterThanOrEqual(0);
    expect(data.connectors).toBeGreaterThanOrEqual(0);
  });
});

test.describe("Skills API", () => {
  test("GET /skills 返回已加载的 Skill 列表", async ({ request }) => {
    const res = await request.get("/skills");

    expect(res.ok()).toBeTruthy();

    const skills = await res.json();
    expect(skills).toBeInstanceOf(Array);
    expect(skills.length).toBeGreaterThan(0);

    const names = skills.map((s: { name: string }) => s.name);
    expect(names).toContain("financial-modeling");
  });

  test("每个 Skill 有必要字段", async ({ request }) => {
    const res = await request.get("/skills");
    const skills = await res.json();

    for (const skill of skills) {
      expect(skill.id).toBeDefined();
      expect(typeof skill.id).toBe("string");
      expect(skill.name).toBeDefined();
    }
  });
});

test.describe("Modes API", () => {
  test("GET /modes 返回模式列表", async ({ request }) => {
    const res = await request.get("/modes");

    expect(res.ok()).toBeTruthy();

    const modes = await res.json();
    expect(modes).toBeInstanceOf(Array);
  });
});

test.describe("Commands API", () => {
  test("GET /commands 返回命令列表", async ({ request }) => {
    const res = await request.get("/commands");

    expect(res.ok()).toBeTruthy();

    const commands = await res.json();
    expect(commands).toBeInstanceOf(Array);
  });
});
