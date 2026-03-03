/**
 * Model Router — 动态模型选择器
 *
 * 根据交互模式、消息长度、工具调用数量等信号，
 * 自动为每次请求选择最合适的 Claude 模型。
 *
 * 模型等级（成本从低到高）：
 *   haiku   → 轻量级，快速应答，成本 ~1/10
 *   sonnet  → 主力模型，能力均衡（默认）
 *   opus    → 深度推理，复杂规划，成本 ~5x
 */

/** 估算文本 token 数（粗略：4 字符 ≈ 1 token）*/
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * 根据请求上下文选择模型
 *
 * @param {object} context
 * @param {string}   context.mode          - 交互模式: 'chat' | 'plan' | 'ask' | 'agent'
 * @param {string}   [context.modelHint]   - 前端显式传入的模型偏好 (sonnet/haiku/opus)
 * @param {Array}    [context.messages]    - 对话历史
 * @param {number}   [context.planSteps]   - Plan 模式步骤数
 * @param {boolean}  [context.hasCode]     - 消息是否包含代码片段
 * @param {string}   [context.defaultModel]- 配置文件里的默认模型
 * @returns {{ model: string, reason: string }}
 */
export function selectModel(context) {
  const {
    mode = "chat",
    modelHint,
    messages = [],
    planSteps = 0,
    hasCode = false,
    defaultModel = "sonnet",
  } = context;

  // ── 规则 0: 前端显式指定，且在白名单内，直接使用 ──────────
  const ALLOWED = new Set(["haiku", "sonnet", "opus"]);
  if (modelHint && ALLOWED.has(modelHint)) {
    return { model: modelHint, reason: `explicit hint: ${modelHint}` };
  }

  // ── 规则 1: Ask 模式 → Haiku（查询类，轻量快速）────────────
  if (mode === "ask") {
    // Ask 模式下如果消息包含代码分析，升级到 Sonnet
    const lastMsg = messages[messages.length - 1]?.content || "";
    const tokenCount = estimateTokens(lastMsg);
    if (tokenCount > 800 || hasCode) {
      return {
        model: "sonnet",
        reason: "ask mode: long query or code analysis",
      };
    }
    return { model: "haiku", reason: "ask mode: simple query" };
  }

  // ── 规则 2: Plan 模式步骤数多 → Opus（深度规划）────────────
  if (mode === "plan" && planSteps > 8) {
    return {
      model: "opus",
      reason: `plan mode: ${planSteps} steps, needs deep reasoning`,
    };
  }

  // ── 规则 3: 消息 token 超过阈值 → Sonnet ────────────────────
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );
  if (totalTokens > 6000) {
    return { model: "sonnet", reason: `long context: ~${totalTokens} tokens` };
  }

  // ── 规则 4: 默认使用配置文件中的 primary 模型 ───────────────
  const resolved = ALLOWED.has(defaultModel) ? defaultModel : "sonnet";
  return { model: resolved, reason: `default: ${resolved}` };
}

/**
 * 将 model 简称解析为完整的 Claude API model ID
 * 用于在日志、调试信息中显示完整名称
 */
export function resolveModelId(model) {
  const MAP = {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  };
  return MAP[model] || model;
}
