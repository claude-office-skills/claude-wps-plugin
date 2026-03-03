import { describe, it, expect } from "vitest";
import { BLOCK_CONFIGS, stripeColor, bgColor, titleColor } from "../../src/config/blockConfig";
import type { SidebarBlockType } from "../../src/types";

const ALL_TYPES: SidebarBlockType[] = [
  "code-js", "code-python", "code-html", "terminal",
  "mcp-tool", "thinking", "plan-steps",
  "exec-result", "data-table", "cell-change", "chart-image",
  "skill-create", "memory", "progress", "approval", "reference",
];

const ALLOWED_STRIPE_VARS = [
  "--accent", "--ui-accent", "--success", "--error",
  "--border-primary", "--text-placeholder", "--plan-color",
];

const ALLOWED_BG_VARS = ["--bg-surface", "--thinking-bg"];

describe("BLOCK_CONFIGS", () => {
  it("has a config for every SidebarBlockType", () => {
    for (const type of ALL_TYPES) {
      expect(BLOCK_CONFIGS[type]).toBeDefined();
      expect(BLOCK_CONFIGS[type].icon).toBeTruthy();
      expect(BLOCK_CONFIGS[type].defaultTitle).toBeTruthy();
    }
  });

  it("uses only design-system stripe colors", () => {
    for (const type of ALL_TYPES) {
      const cfg = BLOCK_CONFIGS[type];
      expect(ALLOWED_STRIPE_VARS).toContain(cfg.stripeVar);
    }
  });

  it("uses only design-system background colors", () => {
    for (const type of ALL_TYPES) {
      const cfg = BLOCK_CONFIGS[type];
      expect(ALLOWED_BG_VARS).toContain(cfg.bgVar);
    }
  });

  it("every config has a valid prominence level", () => {
    for (const type of ALL_TYPES) {
      expect(["prominent", "standard", "ambient"]).toContain(
        BLOCK_CONFIGS[type].prominence,
      );
    }
  });

  it("executable code blocks use --accent stripe", () => {
    for (const type of ["code-js", "code-python", "code-html"] as SidebarBlockType[]) {
      expect(BLOCK_CONFIGS[type].stripeVar).toBe("--accent");
    }
  });

  it("ambient blocks use --thinking-bg background", () => {
    for (const type of ["thinking", "memory", "reference"] as SidebarBlockType[]) {
      expect(BLOCK_CONFIGS[type].bgVar).toBe("--thinking-bg");
      expect(BLOCK_CONFIGS[type].prominence).toBe("ambient");
    }
  });
});

describe("helper functions", () => {
  it("stripeColor returns a var() expression", () => {
    expect(stripeColor("code-js")).toBe("var(--accent)");
    expect(stripeColor("mcp-tool")).toBe("var(--ui-accent)");
  });

  it("bgColor returns a var() expression", () => {
    expect(bgColor("thinking")).toBe("var(--thinking-bg)");
    expect(bgColor("code-js")).toBe("var(--bg-surface)");
  });

  it("titleColor returns a var() expression", () => {
    expect(titleColor("approval")).toBe("var(--error)");
    expect(titleColor("thinking")).toBe("var(--text-muted)");
  });
});
