/**
 * Agent Dispatcher — 意图匹配与自动分派引擎
 *
 * Level 1 (快速): 基于 <example> 标签的关键词匹配，0 额外 token
 * Level 2 (精确): 可选的 LLM 分类器 (haiku)，~200 token
 */

import { matchAgentByIntent, getAgentByName } from "./agent-loader.js";

const MIN_SCORE_THRESHOLD = 4;
const AUTO_DISPATCH_CONFIDENCE = 0.8;

/**
 * 根据用户消息自动分派最佳 Agent
 *
 * @param {string} userMessage - 用户最新消息
 * @param {string|undefined} explicitAgentName - 用户手动指定的 Agent
 * @returns {{ agent: object|null, method: string, confidence: number }}
 */
export function dispatchAgent(userMessage, explicitAgentName) {
  if (explicitAgentName) {
    const agent = getAgentByName(explicitAgentName);
    if (agent) {
      return { agent, method: "explicit", confidence: 1.0 };
    }
  }

  const matches = matchAgentByIntent(userMessage);
  if (matches.length === 0) {
    return { agent: null, method: "none", confidence: 0 };
  }

  const top = matches[0];
  if (top.score < MIN_SCORE_THRESHOLD) {
    return { agent: null, method: "below-threshold", confidence: 0 };
  }

  const secondScore = matches.length > 1 ? matches[1].score : 0;
  const confidence =
    secondScore > 0
      ? Math.min(1, (top.score - secondScore) / top.score + 0.5)
      : Math.min(1, top.score / 20 + 0.5);

  if (confidence >= AUTO_DISPATCH_CONFIDENCE) {
    return { agent: top.agent, method: "auto-l1", confidence };
  }

  return { agent: null, method: "low-confidence", confidence };
}
