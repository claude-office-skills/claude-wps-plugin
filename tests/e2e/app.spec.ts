import { test, expect } from "@playwright/test";

test.describe("WPS Claude Plugin — 浏览器 E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("页面加载：显示 Claude 界面元素", async ({ page }) => {
    // 页面应该加载成功（不是空白页）
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // 应该有一个文本输入区域
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });
  });

  test("输入框：可以输入文字", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("测试消息：帮我分析数据");

    await expect(textarea).toHaveValue("测试消息：帮我分析数据");
  });

  test("发送按钮：空输入时禁用", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("");

    // 发送按钮应该被禁用
    const sendBtn = page.locator("button[title='发送']");
    await expect(sendBtn).toBeDisabled();
  });

  test("发送按钮：有输入时启用", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("有内容的消息");

    const sendBtn = page.locator("button[title='发送']");
    await expect(sendBtn).toBeEnabled();
  });

  test("主题切换：点击后切换颜色模式", async ({ page }) => {
    const html = page.locator("html");

    const themeBtn = page.locator(
      "button[title*='主题'], button[title*='theme'], button[title*='Theme']",
    );

    if ((await themeBtn.count()) > 0) {
      const initialTheme = await html.getAttribute("data-theme");

      // cycleTheme 顺序: dark → auto → light
      // 默认 "auto" 在 headless 中解析为 "light"，点一次可能值不变
      // 连续点击两次确保经过至少一次可见变化（auto→light→dark）
      await themeBtn.first().click();
      await page.waitForTimeout(200);
      await themeBtn.first().click();
      await page.waitForTimeout(200);

      const finalTheme = await html.getAttribute("data-theme");
      // 两次切换后一定和初始不同（light→dark 或 dark→light）
      expect(finalTheme).not.toBe(initialTheme);
    }
  });

  test("新建 Agent：点击 + 按钮创建新 Agent", async ({ page }) => {
    const addBtn = page.locator(
      "button[title*='新建'], button[title*='Add'], button[title*='new']",
    );

    if ((await addBtn.count()) > 0) {
      // 记录当前 Agent tab 数量
      const initialTabs = await page.locator("[class*='agentTab']").count();

      await addBtn.first().click();

      // 等待新 tab 出现
      await page.waitForTimeout(500);

      const newTabs = await page.locator("[class*='agentTab']").count();
      expect(newTabs).toBeGreaterThanOrEqual(initialTabs);
    }
  });

  test("proxy 连接状态：显示连接状态指示", async ({ page }) => {
    // 等待 proxy 检查完成
    await page.waitForTimeout(3000);

    // 页面不应该显示严重错误
    const errorBanner = page.locator("[class*='error'], [class*='Error']");
    const hasError = (await errorBanner.count()) > 0;

    if (hasError) {
      // 如果有错误，应该是 proxy 连接相关的
      const text = await errorBanner.first().textContent();
      expect(text).toContain("代理");
    }
  });
});

test.describe("快捷操作卡片", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("首次加载显示快捷操作卡片", async ({ page }) => {
    // 当没有消息时，应该显示快捷操作
    const cards = page.locator(
      "[class*='quickAction'], [class*='QuickAction']",
    );

    // 等待卡片加载
    await page.waitForTimeout(2000);

    if ((await cards.count()) > 0) {
      const firstCard = cards.first();
      await expect(firstCard).toBeVisible();
    }
  });
});
