/**
 * skill-generator.js — AI-assisted skill creation pipeline.
 *
 * Takes user intent from conversation context and generates a SKILL.md
 * with proper frontmatter structure, ready for preview and confirmation.
 */

const SKILL_TEMPLATE = `---
name: {{NAME}}
description: {{DESCRIPTION}}
version: "1.0.0"
minSystemVersion: "2.3.0"
tags: [{{TAGS}}]
modes: [agent, plan, ask]
context:
  keywords: [{{KEYWORDS}}]
  triggers: [{{TRIGGERS}}]
---

# {{NAME}}

{{BODY}}
`;

/**
 * Generate a SKILL.md content string from structured data.
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.description
 * @param {string[]} params.tags
 * @param {string[]} params.keywords
 * @param {string[]} params.triggers
 * @param {string} params.body
 * @returns {string}
 */
function generateSkillContent({ name, description, tags, keywords, triggers, body }) {
  return SKILL_TEMPLATE
    .replace(/\{\{NAME\}\}/g, name || "Untitled Skill")
    .replace("{{DESCRIPTION}}", description || "")
    .replace("{{TAGS}}", (tags || []).map(t => `"${t}"`).join(", "))
    .replace("{{KEYWORDS}}", (keywords || []).map(k => `"${k}"`).join(", "))
    .replace("{{TRIGGERS}}", (triggers || []).map(t => `"${t}"`).join(", "))
    .replace("{{BODY}}", body || "");
}

/**
 * Build a prompt for Claude to extract skill metadata from user intent.
 * @param {string} userIntent - What the user said about the skill they want to create
 * @param {string} conversationContext - Recent conversation context
 * @returns {string}
 */
function buildSkillExtractionPrompt(userIntent, conversationContext) {
  return `You are a skill metadata extractor. The user wants to create a reusable AI skill.

User intent: "${userIntent}"

Recent context:
${conversationContext || "(none)"}

Extract and return a JSON object with these fields:
{
  "name": "kebab-case-skill-name",
  "description": "One-line description of what this skill does",
  "tags": ["tag1", "tag2"],
  "keywords": ["keyword1", "keyword2"],
  "triggers": ["trigger phrase 1", "trigger phrase 2"],
  "body": "The full skill instruction body in Markdown. Include:\n- When to use this skill\n- Step-by-step instructions\n- Code patterns or templates\n- Examples"
}

IMPORTANT: Return ONLY the JSON object, no markdown fences or extra text.`;
}

/**
 * Parse the AI response for skill metadata.
 * @param {string} aiResponse
 * @returns {Object|null}
 */
function parseSkillResponse(aiResponse) {
  try {
    const cleaned = aiResponse
      .replace(/^```json?\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validate skill metadata before saving.
 * @param {Object} meta
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSkillMeta(meta) {
  const errors = [];
  if (!meta.name || typeof meta.name !== "string") {
    errors.push("name is required and must be a string");
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(meta.name)) {
    errors.push("name must be kebab-case (lowercase, hyphens only)");
  }
  if (!meta.description) errors.push("description is required");
  if (!meta.body || meta.body.length < 10) {
    errors.push("body must contain meaningful instructions (10+ chars)");
  }
  return { valid: errors.length === 0, errors };
}

export {
  generateSkillContent,
  buildSkillExtractionPrompt,
  parseSkillResponse,
  validateSkillMeta,
};
