interface ErrorRule {
  test: RegExp;
  message: string;
}

const ERROR_MAP: ErrorRule[] = [
  {
    test: /403|forbidden|Request not allowed/i,
    message: "当前账号权限不足，请检查 API 订阅状态或切换账号后重试。",
  },
  {
    test: /401|authenticate|Unauthorized|invalid.*key/i,
    message: "认证已过期，请重新登录或检查 API 密钥配置。",
  },
  {
    test: /429|rate.limit|too many|overloaded/i,
    message: "请求过于频繁，请稍等片刻后重试。",
  },
  {
    test: /timeout|timed?\s*out|ETIMEDOUT|aborted|无响应.*终止|响应超时/i,
    message: "请求超时，可能是网络较慢或任务过于复杂，请重试或切换更快的模型。",
  },
  {
    test: /ECONNREFUSED|ENOTFOUND|fetch failed|network|网络连接/i,
    message: "网络连接失败，请检查网络后重试。",
  },
  {
    test: /500|Internal Server Error/i,
    message: "服务端出现临时故障，请稍后重试。",
  },
  {
    test: /502|503|Bad Gateway|Service Unavailable/i,
    message: "AI 服务暂时不可用，请稍后重试。",
  },
  {
    test: /code.*143|SIGTERM|SIGKILL|异常退出/i,
    message: "AI 处理被中断，请简化问题或切换更快的模型后重试。",
  },
  {
    test: /credit|billing|payment|insufficient|额度/i,
    message: "账户额度不足，请检查订阅或充值后重试。",
  },
  {
    test: /model.*not.*found|model.*unavailable/i,
    message: "当前模型暂不可用，请切换其他模型后重试。",
  },
];

export function friendlyErrorMessage(raw: string): string {
  for (const rule of ERROR_MAP) {
    if (rule.test.test(raw)) {
      return rule.message;
    }
  }
  return `出现了一些问题，请重试。如持续出错，请联系管理员。`;
}
