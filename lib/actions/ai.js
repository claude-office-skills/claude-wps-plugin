/**
 * ai.* — AI 驱动的长任务动作
 *
 * 通过 Claude CLI / Python 脚本 / 外部 API 执行耗时 AI 任务。
 * 每个动作返回 { ok, result, ... } 的标准格式。
 *
 * 集成到 Action Registry 后，可被 Workflow Engine 编排。
 */

import { spawn } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { selectModel } from "../model-router.js";

const TEMP_DIR = join(tmpdir(), "claude-wps", "ai-tasks");
try {
  mkdirSync(TEMP_DIR, { recursive: true });
} catch {}

const PYTHON_CMD = process.env.PYTHON_PATH || "python3";

function runPython(script, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(TEMP_DIR, `ai_${Date.now()}.py`);
    writeFileSync(tmpFile, script, "utf-8");
    const child = spawn(PYTHON_CMD, [tmpFile], {
      timeout,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `exit code ${code}`));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", reject);
  });
}

export const aiActions = {
  /**
   * ai.generateImage — 用 Python matplotlib/pillow 生成图表图片
   *
   * params:
   *   type: 'chart' | 'heatmap' | 'diagram'
   *   spec: { chartType, data, title, xlabel, ylabel, ... }
   *   outputPath?: string
   */
  "ai.generateImage": async ({
    type = "chart",
    spec = {},
    outputPath,
    onProgress,
  }) => {
    if (onProgress)
      onProgress({ phase: "preparing", message: "准备生成图片..." });

    const outFile = outputPath || join(TEMP_DIR, `chart_${Date.now()}.png`);
    const { model } = selectModel({
      mode: "ask",
      messages: [{ role: "user", content: "generate chart" }],
    });

    const dataJson = JSON.stringify(spec.data || []);
    const chartType = spec.chartType || "bar";
    const title = (spec.title || "Chart").replace(/'/g, "\\'");
    const xlabel = (spec.xlabel || "").replace(/'/g, "\\'");
    const ylabel = (spec.ylabel || "").replace(/'/g, "\\'");

    const script = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json, sys

data = json.loads('${dataJson.replace(/'/g, "\\'")}')
fig, ax = plt.subplots(figsize=(10, 6))
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

chart_type = '${chartType}'
if chart_type == 'bar':
    labels = [str(d.get('label', d.get('name', i))) for i, d in enumerate(data)]
    values = [d.get('value', 0) for d in data]
    ax.bar(labels, values, color='#60A5FA')
elif chart_type == 'line':
    labels = [str(d.get('label', d.get('name', i))) for i, d in enumerate(data)]
    values = [d.get('value', 0) for d in data]
    ax.plot(labels, values, marker='o', color='#34D399', linewidth=2)
elif chart_type == 'pie':
    labels = [str(d.get('label', d.get('name', ''))) for d in data]
    values = [d.get('value', 0) for d in data]
    ax.pie(values, labels=labels, autopct='%1.1f%%', startangle=90)
elif chart_type == 'scatter':
    xs = [d.get('x', 0) for d in data]
    ys = [d.get('y', 0) for d in data]
    ax.scatter(xs, ys, c='#A78BFA', s=60)
else:
    labels = [str(d.get('label', i)) for i, d in enumerate(data)]
    values = [d.get('value', 0) for d in data]
    ax.bar(labels, values, color='#60A5FA')

ax.set_title('${title}', fontsize=14, pad=12)
if '${xlabel}': ax.set_xlabel('${xlabel}')
if '${ylabel}': ax.set_ylabel('${ylabel}')
plt.tight_layout()
plt.savefig('${outFile.replace(/\\/g, "/")}', dpi=150, bbox_inches='tight')
plt.close()
print('OK')
`;

    if (onProgress)
      onProgress({
        phase: "generating",
        message: `使用 ${model} 模型生成 ${chartType} 图表...`,
      });

    const { stdout, stderr } = await runPython(script, 60_000);
    if (!stdout.includes("OK")) {
      throw new Error(`Chart generation failed: ${stderr}`);
    }

    if (onProgress) onProgress({ phase: "done", message: "图表生成完成" });
    return { ok: true, path: outFile, type: chartType, model };
  },

  /**
   * ai.analyzeData — Python 数据分析（pandas）
   *
   * params:
   *   data: array of objects | CSV string
   *   analysis: 'summary' | 'correlation' | 'outliers' | 'trend'
   *   outputFormat: 'json' | 'text'
   */
  "ai.analyzeData": async ({
    data,
    analysis = "summary",
    outputFormat = "json",
    onProgress,
  }) => {
    if (!data) throw new Error("data is required");

    if (onProgress)
      onProgress({ phase: "preparing", message: "准备数据分析环境..." });

    const dataJson = JSON.stringify(data);
    const tmpData = join(TEMP_DIR, `data_${Date.now()}.json`);
    writeFileSync(tmpData, dataJson, "utf-8");

    const script = `
import pandas as pd, json, sys

with open('${tmpData.replace(/\\/g, "/")}', 'r') as f:
    raw = json.load(f)

df = pd.DataFrame(raw) if isinstance(raw, list) else pd.read_json(json.dumps(raw))

analysis = '${analysis}'
result = {}

if analysis == 'summary':
    desc = df.describe(include='all').to_dict()
    result = {'summary': desc, 'shape': list(df.shape), 'columns': list(df.columns), 'dtypes': {k: str(v) for k, v in df.dtypes.items()}}
elif analysis == 'correlation':
    numeric = df.select_dtypes(include='number')
    corr = numeric.corr().to_dict() if len(numeric.columns) > 1 else {}
    result = {'correlation': corr, 'numeric_columns': list(numeric.columns)}
elif analysis == 'outliers':
    numeric = df.select_dtypes(include='number')
    outliers = {}
    for col in numeric.columns:
        q1, q3 = numeric[col].quantile([0.25, 0.75])
        iqr = q3 - q1
        mask = (numeric[col] < q1 - 1.5*iqr) | (numeric[col] > q3 + 1.5*iqr)
        outliers[col] = {'count': int(mask.sum()), 'indices': list(df.index[mask][:20])}
    result = {'outliers': outliers}
elif analysis == 'trend':
    numeric = df.select_dtypes(include='number')
    trends = {}
    for col in numeric.columns:
        vals = numeric[col].dropna()
        if len(vals) > 1:
            import numpy as np
            x = np.arange(len(vals))
            slope, intercept = np.polyfit(x, vals, 1)
            trends[col] = {'slope': round(float(slope), 4), 'direction': 'up' if slope > 0 else 'down', 'mean': round(float(vals.mean()), 2)}
    result = {'trends': trends}

print(json.dumps(result, ensure_ascii=False, default=str))
`;

    if (onProgress)
      onProgress({
        phase: "analyzing",
        message: `正在运行 ${analysis} 分析...`,
      });

    const { stdout } = await runPython(script, 120_000);
    const parsed = JSON.parse(stdout);

    if (onProgress) onProgress({ phase: "done", message: "数据分析完成" });
    return { ok: true, analysis, result: parsed };
  },

  /**
   * ai.generateReport — 用 AI + Python 生成完整的数据报告（HTML）
   *
   * params:
   *   data: array of objects
   *   title: string
   *   sections: ['summary', 'charts', 'insights']
   */
  "ai.generateReport": async ({
    data,
    title = "数据分析报告",
    sections = ["summary", "charts"],
    onProgress,
  }) => {
    if (!data) throw new Error("data is required");

    if (onProgress)
      onProgress({ phase: "preparing", message: "生成报告结构..." });

    const dataJson = JSON.stringify(data);
    const tmpData = join(TEMP_DIR, `report_data_${Date.now()}.json`);
    const outFile = join(TEMP_DIR, `report_${Date.now()}.html`);
    writeFileSync(tmpData, dataJson, "utf-8");

    const sectionsJson = JSON.stringify(sections);

    const script = `
import pandas as pd, json, base64, io, sys

with open('${tmpData.replace(/\\/g, "/")}', 'r') as f:
    raw = json.load(f)

df = pd.DataFrame(raw)
sections = json.loads('${sectionsJson}')
title = """${title.replace(/"/g, '\\"')}"""

html_parts = [f'''<!DOCTYPE html><html><head><meta charset="utf-8">
<title>{title}</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 1000px; margin: 0 auto; padding: 24px; background: #fafafa; color: #333; }}
h1 {{ color: #1a1a2e; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }}
h2 {{ color: #16213e; margin-top: 32px; }}
table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
th {{ background: #f0f0f0; font-weight: 600; }}
tr:nth-child(even) {{ background: #f9f9f9; }}
.stat-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }}
.stat-card {{ background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; }}
.stat-card .label {{ font-size: 13px; color: #666; }}
.stat-card .value {{ font-size: 24px; font-weight: 700; color: #1a1a2e; }}
img {{ max-width: 100%; border: 1px solid #eee; border-radius: 8px; margin: 12px 0; }}
</style></head><body>
<h1>{title}</h1>
<p style="color:#888;">Generated at: {pd.Timestamp.now().strftime("%Y-%m-%d %H:%M")}</p>
''']

if 'summary' in sections:
    html_parts.append('<h2>数据概览</h2>')
    html_parts.append(f'<p>共 {len(df)} 行, {len(df.columns)} 列</p>')
    desc = df.describe(include='all')
    numeric_cols = df.select_dtypes(include='number').columns
    html_parts.append('<div class="stat-grid">')
    for col in numeric_cols[:8]:
        html_parts.append(f'<div class="stat-card"><div class="label">{col} (均值)</div><div class="value">{df[col].mean():.2f}</div></div>')
    html_parts.append('</div>')
    html_parts.append(desc.to_html())

if 'charts' in sections:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei', 'DejaVu Sans']
    plt.rcParams['axes.unicode_minus'] = False
    html_parts.append('<h2>可视化</h2>')
    for col in numeric_cols[:4]:
        fig, ax = plt.subplots(figsize=(8, 4))
        df[col].hist(ax=ax, bins=20, color='#60A5FA', edgecolor='#fff')
        ax.set_title(f'{col} 分布', fontsize=13)
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        plt.close()
        b64 = base64.b64encode(buf.getvalue()).decode()
        html_parts.append(f'<img src="data:image/png;base64,{b64}" alt="{col}">')

html_parts.append('</body></html>')

with open('${outFile.replace(/\\/g, "/")}', 'w') as f:
    f.write('\\n'.join(html_parts))
print('OK')
`;

    if (onProgress)
      onProgress({
        phase: "generating",
        message: "生成报告中（含图表渲染）...",
      });

    const { stdout, stderr } = await runPython(script, 180_000);
    if (!stdout.includes("OK")) {
      throw new Error(`Report generation failed: ${stderr}`);
    }

    if (onProgress) onProgress({ phase: "done", message: "报告已生成" });
    return { ok: true, path: outFile, title };
  },

  /**
   * ai.batchProcess — 批量处理数据行（map 模式）
   *
   * params:
   *   data: array
   *   operation: 'classify' | 'extract' | 'translate' | 'clean'
   *   batchSize: number (default 50)
   */
  "ai.batchProcess": async ({
    data,
    operation = "clean",
    batchSize = 50,
    onProgress,
  }) => {
    if (!data || !Array.isArray(data))
      throw new Error("data array is required");

    const total = data.length;
    const batches = [];
    for (let i = 0; i < total; i += batchSize) {
      batches.push(data.slice(i, i + batchSize));
    }

    if (onProgress)
      onProgress({
        phase: "start",
        message: `批量处理 ${total} 条数据（${batches.length} 批）`,
        total,
      });

    const results = [];
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (onProgress) {
        onProgress({
          phase: "processing",
          message: `处理第 ${i + 1}/${batches.length} 批...`,
          current: results.length,
          total,
        });
      }

      const tmpData = join(TEMP_DIR, `batch_${Date.now()}.json`);
      writeFileSync(tmpData, JSON.stringify(batch), "utf-8");

      const script = `
import json
with open('${tmpData.replace(/\\/g, "/")}', 'r') as f:
    batch = json.load(f)

op = '${operation}'
out = []
for row in batch:
    if isinstance(row, dict):
        processed = {k: (str(v).strip() if isinstance(v, str) else v) for k, v in row.items()}
    else:
        processed = str(row).strip()
    out.append(processed)

print(json.dumps(out, ensure_ascii=False))
`;

      const { stdout } = await runPython(script, 60_000);
      const parsed = JSON.parse(stdout);
      results.push(...parsed);
    }

    if (onProgress)
      onProgress({
        phase: "done",
        message: `批量处理完成: ${results.length} 条`,
        total: results.length,
      });
    return { ok: true, count: results.length, result: results };
  },
};
