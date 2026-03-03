import { describe, it, expect } from "vitest";
import {
  blockTypeFromLanguage,
  isSpecialBlock,
  parseInlineMarker,
  isExecutableBlock,
  blockTypeLabel,
} from "../../src/utils/blockParser";

describe("blockTypeFromLanguage", () => {
  it("maps JS variants to code-js", () => {
    expect(blockTypeFromLanguage("javascript")).toBe("code-js");
    expect(blockTypeFromLanguage("js")).toBe("code-js");
    expect(blockTypeFromLanguage("typescript")).toBe("code-js");
    expect(blockTypeFromLanguage("ts")).toBe("code-js");
    expect(blockTypeFromLanguage("jsx")).toBe("code-js");
  });

  it("maps Python variants to code-python", () => {
    expect(blockTypeFromLanguage("python")).toBe("code-python");
    expect(blockTypeFromLanguage("py")).toBe("code-python");
  });

  it("maps HTML variants to code-html", () => {
    expect(blockTypeFromLanguage("html")).toBe("code-html");
    expect(blockTypeFromLanguage("htm")).toBe("code-html");
  });

  it("maps shell variants to terminal", () => {
    expect(blockTypeFromLanguage("bash")).toBe("terminal");
    expect(blockTypeFromLanguage("shell")).toBe("terminal");
    expect(blockTypeFromLanguage("sh")).toBe("terminal");
    expect(blockTypeFromLanguage("zsh")).toBe("terminal");
  });

  it("maps special markers to block types", () => {
    expect(blockTypeFromLanguage("thinking")).toBe("thinking");
    expect(blockTypeFromLanguage("memory")).toBe("memory");
    expect(blockTypeFromLanguage("plan")).toBe("plan-steps");
    expect(blockTypeFromLanguage("mcp-call")).toBe("mcp-tool");
  });

  it("falls back to code-js for unknown languages", () => {
    expect(blockTypeFromLanguage("rust")).toBe("code-js");
    expect(blockTypeFromLanguage("go")).toBe("code-js");
    expect(blockTypeFromLanguage("unknown")).toBe("code-js");
  });

  it("is case-insensitive", () => {
    expect(blockTypeFromLanguage("JavaScript")).toBe("code-js");
    expect(blockTypeFromLanguage("PYTHON")).toBe("code-python");
    expect(blockTypeFromLanguage("HTML")).toBe("code-html");
  });

  it("trims whitespace", () => {
    expect(blockTypeFromLanguage("  python  ")).toBe("code-python");
  });
});

describe("isSpecialBlock", () => {
  it("returns true for marker-based languages", () => {
    expect(isSpecialBlock("thinking")).toBe(true);
    expect(isSpecialBlock("memory")).toBe(true);
    expect(isSpecialBlock("progress")).toBe(true);
    expect(isSpecialBlock("approval")).toBe(true);
  });

  it("returns false for code languages", () => {
    expect(isSpecialBlock("javascript")).toBe(false);
    expect(isSpecialBlock("python")).toBe(false);
    expect(isSpecialBlock("html")).toBe(false);
  });
});

describe("parseInlineMarker", () => {
  it("parses [thinking] marker", () => {
    expect(parseInlineMarker("[thinking] some content")).toBe("thinking");
  });

  it("parses [memory] marker", () => {
    expect(parseInlineMarker("[memory] remembered fact")).toBe("memory");
  });

  it("parses [progress] marker", () => {
    expect(parseInlineMarker("[progress] step 2 of 5")).toBe("progress");
  });

  it("returns null for non-marker text", () => {
    expect(parseInlineMarker("regular text")).toBeNull();
    expect(parseInlineMarker("")).toBeNull();
  });

  it("returns null for unknown markers", () => {
    expect(parseInlineMarker("[unknown] text")).toBeNull();
  });
});

describe("isExecutableBlock", () => {
  it("returns true for code types", () => {
    expect(isExecutableBlock("code-js")).toBe(true);
    expect(isExecutableBlock("code-python")).toBe(true);
    expect(isExecutableBlock("code-html")).toBe(true);
    expect(isExecutableBlock("terminal")).toBe(true);
  });

  it("returns false for non-code types", () => {
    expect(isExecutableBlock("thinking")).toBe(false);
    expect(isExecutableBlock("mcp-tool")).toBe(false);
    expect(isExecutableBlock("plan-steps")).toBe(false);
    expect(isExecutableBlock("data-table")).toBe(false);
  });
});

describe("blockTypeLabel", () => {
  it("returns Chinese labels for common types", () => {
    expect(blockTypeLabel("exec-result")).toBe("执行结果");
    expect(blockTypeLabel("data-table")).toBe("数据预览");
    expect(blockTypeLabel("cell-change")).toBe("表格变更");
  });

  it("returns English labels for code types", () => {
    expect(blockTypeLabel("code-js")).toBe("JavaScript");
    expect(blockTypeLabel("code-python")).toBe("Python");
    expect(blockTypeLabel("terminal")).toBe("Terminal");
  });
});
