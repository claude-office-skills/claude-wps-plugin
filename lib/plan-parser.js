/**
 * plan-parser.js — Extract structured plan steps from AI response content.
 *
 * Recognizes patterns:
 *   - "Step 1: ..." / "步骤 1: ..."
 *   - "1. ..." numbered lists
 *   - "- [ ] ..." / "- [x] ..." checkbox format
 */

/**
 * @typedef {Object} ParsedStep
 * @property {number} index
 * @property {string} text
 * @property {boolean} done
 * @property {string} [codeBlockId]
 */

const STEP_PATTERNS = [
  /^(?:Step|步骤)\s*(\d+)\s*[:：]\s*(.+)/im,
  /^(\d+)\.\s+(.+)/m,
  /^[-*]\s*\[([ xX])\]\s*(.+)/m,
];

/**
 * Parse AI response content into structured plan steps.
 * @param {string} content - The AI response text
 * @returns {ParsedStep[]}
 */
function parsePlanSteps(content) {
  const lines = content.split("\n");
  const steps = [];
  let stepIndex = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Pattern 1: "Step N: ..." or "步骤 N: ..."
    const stepMatch = /^(?:Step|步骤)\s*(\d+)\s*[:：]\s*(.+)/i.exec(trimmed);
    if (stepMatch) {
      steps.push({
        index: stepIndex++,
        text: stepMatch[2].trim(),
        done: false,
      });
      continue;
    }

    // Pattern 2: "N. ..."
    const numMatch = /^(\d+)\.\s+(.+)/.exec(trimmed);
    if (numMatch && steps.length < 20) {
      steps.push({
        index: stepIndex++,
        text: numMatch[2].trim(),
        done: false,
      });
      continue;
    }

    // Pattern 3: "- [ ] ..." / "- [x] ..."
    const checkMatch = /^[-*]\s*\[([ xX])\]\s*(.+)/.exec(trimmed);
    if (checkMatch) {
      steps.push({
        index: stepIndex++,
        text: checkMatch[2].trim(),
        done: checkMatch[1].toLowerCase() === "x",
      });
      continue;
    }
  }

  return steps;
}

/**
 * Try to associate code blocks with plan steps by proximity.
 * @param {ParsedStep[]} steps
 * @param {{ id: string, language: string, code: string }[]} codeBlocks
 * @param {string} content
 * @returns {ParsedStep[]}
 */
function associateCodeBlocks(steps, codeBlocks, content) {
  if (!codeBlocks || codeBlocks.length === 0 || steps.length === 0) {
    return steps;
  }

  const lines = content.split("\n");
  const stepLineMap = new Map();

  let stepIdx = 0;
  for (let i = 0; i < lines.length && stepIdx < steps.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.includes(steps[stepIdx].text.slice(0, 30))) {
      stepLineMap.set(stepIdx, i);
      stepIdx++;
    }
  }

  const codeLineMap = new Map();
  for (const block of codeBlocks) {
    const firstLine = block.code.split("\n")[0];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("```") && i + 1 < lines.length) {
        if (lines[i + 1].trim().startsWith(firstLine.trim().slice(0, 20))) {
          codeLineMap.set(i, block.id);
          break;
        }
      }
    }
  }

  return steps.map((step, si) => {
    const stepLine = stepLineMap.get(si);
    if (stepLine === undefined) return step;

    let closestBlockId = null;
    let closestDist = Infinity;
    for (const [codeLine, blockId] of codeLineMap.entries()) {
      const dist = codeLine - stepLine;
      if (dist > 0 && dist < closestDist) {
        closestDist = dist;
        closestBlockId = blockId;
      }
    }

    return closestBlockId ? { ...step, codeBlockId: closestBlockId } : step;
  });
}

export { parsePlanSteps, associateCodeBlocks };
