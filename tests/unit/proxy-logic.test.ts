/**
 * proxy-server.js 核心逻辑的单元测试
 *
 * 由于 proxy-server.js 是单体 ESM 文件，无法直接 import 内部函数。
 * 这里复制核心逻辑进行独立测试，确保行为一致。
 * 后续可重构为独立模块。
 */
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";

// ── 从 proxy-server.js 复制的纯函数 ─────────────────────────────

function parseFrontmatter(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {} as Record<string, unknown>, body: raw };

  try {
    const fm = (yaml.load(match[1]) as Record<string, unknown>) || {};
    return { frontmatter: fm, body: match[2].trim() };
  } catch {
    return {
      frontmatter: {} as Record<string, unknown>,
      body: match[2].trim(),
    };
  }
}

interface SkillEntry {
  name: string;
  body: string;
  context?: {
    always?: boolean | string;
    keywords?: string[];
    hasEmptyCells?: boolean | string;
    hasFormulas?: boolean | string;
    minRows?: number;
    priority?: number;
  };
  modes?: string[];
  [key: string]: unknown;
}

const SKILL_MAX_LOAD = 4;

function matchSkills(
  allSkills: Map<string, SkillEntry>,
  userMessage: string,
  wpsContext: {
    selection?: {
      emptyCellCount?: number;
      hasFormulas?: boolean;
      rowCount?: number;
    };
  } | null,
  mode: string | null,
  maxLoad?: number,
): SkillEntry[] {
  const scored: { skill: SkillEntry; score: number; bodyLen: number }[] = [];
  const msg = (userMessage || "").toLowerCase();
  const limit = maxLoad || SKILL_MAX_LOAD;

  for (const [, skill] of allSkills) {
    if (mode && Array.isArray(skill.modes) && !skill.modes.includes(mode)) {
      continue;
    }

    const ctx = skill.context || {};
    let score = 0;

    if (ctx.always === true || ctx.always === "true") {
      score = 100;
    } else {
      if (Array.isArray(ctx.keywords)) {
        for (const kw of ctx.keywords) {
          if (msg.includes(kw.toLowerCase())) {
            score += kw.length >= 4 ? 10 : 5;
          }
        }
      }
      if (wpsContext && wpsContext.selection) {
        const sel = wpsContext.selection;
        if (
          (ctx.hasEmptyCells === true || ctx.hasEmptyCells === "true") &&
          sel.emptyCellCount &&
          sel.emptyCellCount > 0
        )
          score += 8;
        if (
          (ctx.hasFormulas === true || ctx.hasFormulas === "true") &&
          sel.hasFormulas
        )
          score += 8;
        if (ctx.minRows && sel.rowCount && sel.rowCount >= Number(ctx.minRows))
          score += 5;
      }
    }

    if (score > 0) {
      const bodyLen = (skill.body || "").length;
      const priority = Number(ctx.priority) || 0;
      scored.push({ skill, score: score + priority, bodyLen });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const result: SkillEntry[] = [];
  let totalBodyLen = 0;
  const BODY_BUDGET = 12000;

  for (const entry of scored) {
    if (result.length >= limit) break;
    if (
      entry.skill.context?.always ||
      totalBodyLen + entry.bodyLen <= BODY_BUDGET
    ) {
      result.push(entry.skill);
      totalBodyLen += entry.bodyLen;
    }
  }

  return result;
}

const CONTEXT_ROW_THRESHOLD = 30;
const CONTEXT_SAMPLE_HEAD = 5;
const CONTEXT_SAMPLE_TAIL = 3;

function smartSampleContext(contextStr: string): string {
  const lines = contextStr.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const tableMatch = line.match(
      /\[(?:完整工作表数据|当前选区)\]\s*.*?(\d+)行\s*×\s*(\d+)列/,
    );

    if (tableMatch) {
      const totalRows = parseInt(tableMatch[1], 10);
      result.push(line);
      i++;

      if (totalRows <= CONTEXT_ROW_THRESHOLD) {
        while (i < lines.length && lines[i].includes("\t")) {
          result.push(lines[i]);
          i++;
        }
      } else {
        const dataLines: string[] = [];
        while (i < lines.length && lines[i].includes("\t")) {
          dataLines.push(lines[i]);
          i++;
        }

        if (dataLines.length > 0) {
          result.push(dataLines[0]);
        }

        const headEnd = Math.min(CONTEXT_SAMPLE_HEAD + 1, dataLines.length);
        for (let h = 1; h < headEnd; h++) {
          result.push(dataLines[h]);
        }

        if (dataLines.length > headEnd + CONTEXT_SAMPLE_TAIL) {
          result.push(
            `... (省略 ${dataLines.length - headEnd - CONTEXT_SAMPLE_TAIL} 行，共 ${totalRows} 行)`,
          );
        }

        const tailStart = Math.max(
          headEnd,
          dataLines.length - CONTEXT_SAMPLE_TAIL,
        );
        for (let t = tailStart; t < dataLines.length; t++) {
          result.push(dataLines[t]);
        }
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

// ── 测试 ────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("解析标准 YAML frontmatter", () => {
    const raw = `---
name: test-skill
version: 1.0.0
context:
  keywords:
    - DCF
    - 估值
---
这是 Skill 内容。`;

    const { frontmatter, body } = parseFrontmatter(raw);

    expect(frontmatter.name).toBe("test-skill");
    expect(frontmatter.version).toBe("1.0.0");
    expect(body).toBe("这是 Skill 内容。");
  });

  it("无 frontmatter 时返回整个内容作为 body", () => {
    const raw = "没有 frontmatter 的纯文本";
    const { frontmatter, body } = parseFrontmatter(raw);

    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it("YAML 格式错误时降级为空 frontmatter", () => {
    const raw = `---
invalid: [yaml: {broken
---
内容部分`;

    const { frontmatter, body } = parseFrontmatter(raw);

    expect(frontmatter).toEqual({});
    expect(body).toBe("内容部分");
  });

  it("解析嵌套 context 对象", () => {
    const raw = `---
name: financial-modeling
context:
  always: false
  keywords:
    - DCF
    - 现金流折现
    - 估值模型
  priority: 5
---
body here`;

    const { frontmatter } = parseFrontmatter(raw);
    const ctx = frontmatter.context as Record<string, unknown>;

    expect(ctx.always).toBe(false);
    expect(ctx.keywords).toEqual(["DCF", "现金流折现", "估值模型"]);
    expect(ctx.priority).toBe(5);
  });
});

describe("matchSkills", () => {
  function makeSkillMap(
    entries: [string, Partial<SkillEntry>][],
  ): Map<string, SkillEntry> {
    const map = new Map<string, SkillEntry>();
    for (const [id, partial] of entries) {
      map.set(id, {
        name: partial.name || id,
        body: partial.body || "skill body content",
        context: partial.context,
        ...partial,
      });
    }
    return map;
  }

  it("按关键词权重排序：长关键词 10 分，短关键词 5 分", () => {
    const skills = makeSkillMap([
      [
        "data-analysis",
        { context: { keywords: ["分析", "数据分析", "数据处理"] } },
      ],
      [
        "financial-modeling",
        { context: { keywords: ["DCF", "现金流折现", "估值模型"] } },
      ],
    ]);

    const result = matchSkills(skills, "帮我做数据分析", null, null);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe("data-analysis");
  });

  it("always=true 的 Skill 始终匹配（分数 100）", () => {
    const skills = makeSkillMap([
      ["core-api", { context: { always: true, keywords: [] } }],
      ["optional", { context: { keywords: ["完全不相关的关键词xxxyyy"] } }],
    ]);

    const result = matchSkills(skills, "随便说什么", null, null);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("core-api");
  });

  it("always='true' 字符串形式也生效", () => {
    const skills = makeSkillMap([
      ["core-api", { context: { always: "true" as unknown as boolean } }],
    ]);

    const result = matchSkills(skills, "任意消息", null, null);
    expect(result.length).toBe(1);
  });

  it("无匹配关键词时返回空数组", () => {
    const skills = makeSkillMap([
      ["finance", { context: { keywords: ["DCF", "估值"] } }],
    ]);

    const result = matchSkills(skills, "今天天气怎么样", null, null);
    expect(result).toEqual([]);
  });

  it("maxLoad 限制返回数量", () => {
    const skills = makeSkillMap([
      ["s1", { context: { keywords: ["测试"] } }],
      ["s2", { context: { keywords: ["测试"] } }],
      ["s3", { context: { keywords: ["测试"] } }],
      ["s4", { context: { keywords: ["测试"] } }],
      ["s5", { context: { keywords: ["测试"] } }],
    ]);

    const result = matchSkills(skills, "测试一下", null, null, 2);
    expect(result.length).toBe(2);
  });

  it("mode 过滤：非当前模式的 Skill 被排除", () => {
    const skills = makeSkillMap([
      ["agent-only", { context: { keywords: ["数据"] }, modes: ["agent"] }],
      ["plan-only", { context: { keywords: ["数据"] }, modes: ["plan"] }],
      ["all-modes", { context: { keywords: ["数据"] } }],
    ]);

    const result = matchSkills(skills, "数据分析", null, "plan");

    const names = result.map((s) => s.name);
    expect(names).toContain("plan-only");
    expect(names).toContain("all-modes");
    expect(names).not.toContain("agent-only");
  });

  it("body 预算限制：超过 12000 字符的 Skill 被裁剪", () => {
    const bigBody = "x".repeat(11000);
    const skills = makeSkillMap([
      ["big1", { body: bigBody, context: { keywords: ["测试"] } }],
      ["big2", { body: bigBody, context: { keywords: ["测试"] } }],
    ]);

    const result = matchSkills(skills, "测试", null, null);
    expect(result.length).toBe(1);
  });

  it("WPS 上下文：hasEmptyCells 加分", () => {
    const skills = makeSkillMap([
      ["filler", { context: { keywords: ["填充"], hasEmptyCells: true } }],
      ["reader", { context: { keywords: ["填充"] } }],
    ]);

    const wpsCtx = { selection: { emptyCellCount: 10, rowCount: 5 } };

    const result = matchSkills(skills, "填充数据", wpsCtx, null);

    expect(result[0].name).toBe("filler");
  });

  it("中文关键词匹配：'帮我估值苹果' 匹配 '估值'", () => {
    const skills = makeSkillMap([
      [
        "equity-valuation",
        {
          context: {
            keywords: [
              "估值",
              "估值报告",
              "投资分析",
              "stock analysis",
              "valuation",
            ],
          },
        },
      ],
    ]);

    const result = matchSkills(skills, "帮我估值苹果公司", null, null);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("equity-valuation");
  });

  it("多关键词累加：匹配更多关键词分数更高", () => {
    const skills = makeSkillMap([
      [
        "finance",
        {
          context: {
            keywords: ["DCF", "估值", "现金流折现", "估值模型", "WACC"],
          },
        },
      ],
      ["simple", { context: { keywords: ["模型"] } }],
    ]);

    const result = matchSkills(
      skills,
      "帮我做DCF估值模型，计算WACC",
      null,
      null,
    );

    expect(result[0].name).toBe("finance");
  });
});

describe("smartSampleContext", () => {
  it("小表（≤30行）保留全部数据", () => {
    const ctx = `[当前选区] Sheet1!A1:D10，10行 × 4列
姓名\t部门\t销售额\t日期
张三\t销售部\t12500\t2024-01-15
李四\t销售部\t8900\t2024-01-16`;

    const result = smartSampleContext(ctx);
    expect(result).toContain("张三");
    expect(result).toContain("李四");
    expect(result).not.toContain("省略");
  });

  it("大表（>30行）智能采样：头部 + 尾部 + 省略标记", () => {
    const header = "姓名\t部门\t销售额";
    const rows: string[] = [header];
    for (let i = 1; i <= 50; i++) {
      rows.push(`员工${i}\t部门${(i % 5) + 1}\t${1000 * i}`);
    }

    const ctx = `[当前选区] Sheet1!A1:C51，50行 × 3列\n${rows.join("\n")}`;

    const result = smartSampleContext(ctx);
    expect(result).toContain("员工1");
    expect(result).toContain("省略");
    expect(result).toContain("共 50 行");
    expect(result).toContain("员工50");
  });

  it("非表格内容原样保留", () => {
    const ctx = `工作簿: test.xlsx
当前无选区`;

    const result = smartSampleContext(ctx);
    expect(result).toBe(ctx);
  });
});

describe("extractCodeBlocks (from claudeClient.ts)", () => {
  function extractCodeBlocks(
    text: string,
  ): Array<{ language: string; code: string }> {
    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks: Array<{ language: string; code: string }> = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        language: match[1] || "javascript",
        code: match[2].trim(),
      });
    }
    return blocks;
  }

  it("提取 JavaScript 代码块", () => {
    const text = '回复内容\n```javascript\nconsole.log("hello");\n```\n完成';

    const blocks = extractCodeBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe("javascript");
    expect(blocks[0].code).toBe('console.log("hello");');
  });

  it("提取多个不同语言的代码块", () => {
    const text = `
\`\`\`python
print("hello")
\`\`\`
中间文字
\`\`\`sql
SELECT * FROM users;
\`\`\``;

    const blocks = extractCodeBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe("python");
    expect(blocks[1].language).toBe("sql");
  });

  it("无语言标记时默认 javascript", () => {
    const text = "```\nvar x = 1;\n```";

    const blocks = extractCodeBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe("javascript");
  });

  it("空输入返回空数组", () => {
    expect(extractCodeBlocks("")).toEqual([]);
    expect(extractCodeBlocks("没有代码块的文字")).toEqual([]);
  });
});

describe("parsePlanSteps (from App.tsx)", () => {
  const PLAN_STEP_RE = /^(?:\d+)[.)]\s+(.+)$/;

  function parsePlanSteps(
    text: string,
    mode: string,
  ): { index: number; text: string; done: boolean }[] | undefined {
    if (mode !== "plan") return undefined;
    const lines = text.split("\n");
    const steps: { index: number; text: string; done: boolean }[] = [];
    let idx = 1;
    for (const line of lines) {
      const m = PLAN_STEP_RE.exec(line.trim());
      if (m) {
        steps.push({ index: idx++, text: m[1].trim(), done: false });
      }
    }
    return steps.length >= 2 ? steps : undefined;
  }

  it("非 plan 模式返回 undefined", () => {
    expect(parsePlanSteps("1. step 1\n2. step 2", "agent")).toBeUndefined();
    expect(parsePlanSteps("1. step 1\n2. step 2", "ask")).toBeUndefined();
  });

  it("解析带 . 的步骤列表", () => {
    const text = "1. 获取数据\n2. 建立模型\n3. 输出结果";

    const steps = parsePlanSteps(text, "plan");

    expect(steps).toHaveLength(3);
    expect(steps![0]).toEqual({ index: 1, text: "获取数据", done: false });
    expect(steps![2]).toEqual({ index: 3, text: "输出结果", done: false });
  });

  it("解析带 ) 的步骤列表", () => {
    const text = "1) 第一步\n2) 第二步\n3) 第三步";

    const steps = parsePlanSteps(text, "plan");

    expect(steps).toHaveLength(3);
  });

  it("不足 2 步时返回 undefined", () => {
    expect(parsePlanSteps("1. 只有一步", "plan")).toBeUndefined();
  });

  it("混合文字和步骤", () => {
    const text = `这是一个计划：
1. 获取紫金矿业财务数据
2. 建立 DCF 模型
备注：这是额外说明
3. 敏感性分析`;

    const steps = parsePlanSteps(text, "plan");

    expect(steps).toHaveLength(3);
    expect(steps![0].text).toBe("获取紫金矿业财务数据");
  });
});
