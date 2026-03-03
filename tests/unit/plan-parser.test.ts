import { describe, it, expect } from "vitest";

// plan-parser.js is CJS, use dynamic import workaround
const { parsePlanSteps, associateCodeBlocks } = await import("../../lib/plan-parser.js");

describe("parsePlanSteps", () => {
  it("parses 'Step N:' format", () => {
    const content = `Step 1: 获取数据\nStep 2: 建立模型\nStep 3: 输出结果`;
    const steps = parsePlanSteps(content);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({ index: 1, text: "获取数据", done: false });
    expect(steps[2]).toEqual({ index: 3, text: "输出结果", done: false });
  });

  it("parses '步骤 N：' Chinese format", () => {
    const content = `步骤 1：读取表格\n步骤 2：处理数据`;
    const steps = parsePlanSteps(content);
    expect(steps).toHaveLength(2);
    expect(steps[0].text).toBe("读取表格");
  });

  it("parses 'N.' numbered format", () => {
    const content = `1. First step\n2. Second step\n3. Third step`;
    const steps = parsePlanSteps(content);
    expect(steps).toHaveLength(3);
  });

  it("parses checkbox format", () => {
    const content = `- [ ] Pending task\n- [x] Completed task\n- [ ] Another task`;
    const steps = parsePlanSteps(content);
    expect(steps).toHaveLength(3);
    expect(steps[0].done).toBe(false);
    expect(steps[1].done).toBe(true);
    expect(steps[2].done).toBe(false);
  });

  it("handles mixed content with non-step lines", () => {
    const content = `Here is the plan:\n1. Step one\nSome notes\n2. Step two\n\nConclusion`;
    const steps = parsePlanSteps(content);
    expect(steps).toHaveLength(2);
  });

  it("returns empty for content with no steps", () => {
    const steps = parsePlanSteps("Just regular text without any steps");
    expect(steps).toEqual([]);
  });

  it("returns empty for empty input", () => {
    const steps = parsePlanSteps("");
    expect(steps).toEqual([]);
  });
});

describe("associateCodeBlocks", () => {
  it("returns steps unchanged when no code blocks provided", () => {
    const steps = [{ index: 1, text: "Do something", done: false }];
    const result = associateCodeBlocks(steps, [], "content");
    expect(result).toEqual(steps);
  });

  it("returns steps unchanged when steps are empty", () => {
    const result = associateCodeBlocks([], [{ id: "b1", language: "js", code: "x=1" }], "```js\nx=1\n```");
    expect(result).toEqual([]);
  });
});
