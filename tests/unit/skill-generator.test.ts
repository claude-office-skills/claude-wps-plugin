import { describe, it, expect } from "vitest";

const {
  generateSkillContent,
  buildSkillExtractionPrompt,
  parseSkillResponse,
  validateSkillMeta,
} = await import("../../lib/skill-generator.js");

describe("generateSkillContent", () => {
  it("generates a valid SKILL.md with frontmatter", () => {
    const content = generateSkillContent({
      name: "my-tool",
      description: "A test tool",
      tags: ["test", "utility"],
      keywords: ["test", "debug"],
      triggers: ["run test"],
      body: "## Instructions\n\nDo the test.",
    });

    expect(content).toContain("name: my-tool");
    expect(content).toContain("description: A test tool");
    expect(content).toContain('"test"');
    expect(content).toContain("## Instructions");
    expect(content).toContain("minSystemVersion:");
  });

  it("handles empty arrays", () => {
    const content = generateSkillContent({
      name: "empty",
      description: "",
      tags: [],
      keywords: [],
      triggers: [],
      body: "",
    });

    expect(content).toContain("name: empty");
    expect(content).toContain("tags: []");
  });
});

describe("buildSkillExtractionPrompt", () => {
  it("includes user intent in the prompt", () => {
    const prompt = buildSkillExtractionPrompt("create a data cleaner", "we were discussing data");
    expect(prompt).toContain("create a data cleaner");
    expect(prompt).toContain("we were discussing data");
  });

  it("handles no context", () => {
    const prompt = buildSkillExtractionPrompt("my skill", "");
    expect(prompt).toContain("my skill");
    expect(prompt).toContain("(none)");
  });
});

describe("parseSkillResponse", () => {
  it("parses clean JSON", () => {
    const json = JSON.stringify({
      name: "parsed-skill",
      description: "desc",
      tags: [],
      keywords: [],
      triggers: [],
      body: "content",
    });
    const result = parseSkillResponse(json);
    expect(result).not.toBeNull();
    expect(result.name).toBe("parsed-skill");
  });

  it("parses JSON wrapped in markdown fences", () => {
    const response = '```json\n{"name":"fenced","description":"d","body":"b"}\n```';
    const result = parseSkillResponse(response);
    expect(result).not.toBeNull();
    expect(result.name).toBe("fenced");
  });

  it("extracts JSON embedded in other text", () => {
    const response = 'Here is the result:\n{"name":"embedded","description":"d","body":"b"}\nDone.';
    const result = parseSkillResponse(response);
    expect(result).not.toBeNull();
    expect(result.name).toBe("embedded");
  });

  it("returns null for non-JSON input", () => {
    expect(parseSkillResponse("not json at all")).toBeNull();
  });
});

describe("validateSkillMeta", () => {
  it("validates a correct skill", () => {
    const result = validateSkillMeta({
      name: "valid-skill",
      description: "A valid skill",
      body: "This is the body content with instructions",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing name", () => {
    const result = validateSkillMeta({ description: "d", body: "long enough body" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("name"))).toBe(true);
  });

  it("rejects non-kebab-case name", () => {
    const result = validateSkillMeta({ name: "Not Kebab", description: "d", body: "long enough body" });
    expect(result.valid).toBe(false);
  });

  it("rejects short body", () => {
    const result = validateSkillMeta({ name: "ok-name", description: "d", body: "short" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("body"))).toBe(true);
  });

  it("rejects missing description", () => {
    const result = validateSkillMeta({ name: "ok-name", body: "long enough body" });
    expect(result.valid).toBe(false);
  });
});
