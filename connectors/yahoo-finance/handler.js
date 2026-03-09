/**
 * Yahoo Finance 连接器 handler
 *
 * 通过 Python yfinance 库获取全球上市公司金融数据。
 * 无需凭证（Yahoo Finance 免费公开数据）。
 */

import { spawn } from "child_process";

function runYfinance(script) {
  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["-c", script], { timeout: 60000 });
    let stdout = "";
    let stderr = "";
    py.stdout.on("data", (d) => { stdout += d; });
    py.stderr.on("data", (d) => { stderr += d; });
    py.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim().substring(0, 300) || `exit ${code}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("JSON parse: " + stdout.substring(0, 200)));
      }
    });
    py.on("error", (err) => reject(err));
  });
}

function sanitizeTicker(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9._-]/g, "");
}

async function pullStockInfo(ticker, cache) {
  const cacheKey = `yahoo:info:${ticker}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await runYfinance(`
import yfinance as yf, json, sys, math
t = yf.Ticker("${ticker}")
info = t.info or {}
if not info.get("shortName"):
    print(json.dumps({"error":"ticker not found","ticker":"${ticker}"}))
    sys.exit(0)
def s(v):
    if v is None: return None
    try:
        if math.isnan(float(v)): return None
    except: pass
    return v
_sm = {k:s(info.get(k)) for k in ["shortName","currency","currentPrice","targetMeanPrice","targetHighPrice","targetLowPrice","recommendationKey","totalRevenue","revenueGrowth","grossMargins","ebitdaMargins","operatingMargins","profitMargins","totalCash","totalDebt","debtToEquity","returnOnEquity","returnOnAssets","freeCashflow","operatingCashflow","earningsGrowth","sector","industry","fullTimeEmployees"]}
_sm["grossProfit"] = s(info.get("grossProfits")) or s(info.get("grossProfit"))
_sm["netIncome"] = s(info.get("netIncomeToCommon")) or s(info.get("netIncome"))
_sm["operatingIncome"] = s(info.get("operatingIncome"))
out = {"ticker":"${ticker}","fetchedAt":__import__("datetime").datetime.now().isoformat(),
  "summary":_sm,
  "keyStats":{k:s(info.get(k)) for k in ["beta","trailingPE","forwardPE","priceToBook","enterpriseValue","enterpriseToRevenue","enterpriseToEbitda","pegRatio","sharesOutstanding","bookValue","dividendYield","marketCap"]}}
def to_camel(name):
    parts = name.replace(" ","_").lower().split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])
def extract_df(df, fields):
    if df is None or df.empty: return []
    rows = []
    for col in df.columns[:4]:
        r = {"endDate": col.strftime("%Y-%m-%d") if hasattr(col,"strftime") else str(col)}
        for f in fields:
            if f in df.index:
                v = df.loc[f, col]
                r[to_camel(f)] = None if (v is None or (isinstance(v,float) and math.isnan(v))) else float(v)
        rows.append(r)
    return rows
try: out["incomeStatements"] = extract_df(t.income_stmt, ["Total Revenue","Cost Of Revenue","Gross Profit","Operating Income","Net Income","EBIT","EBITDA","Interest Expense","Tax Provision","Research Development","Selling General Administrative"])
except: out["incomeStatements"] = []
try: out["balanceSheets"] = extract_df(t.balance_sheet, ["Total Assets","Total Current Assets","Total Liabilities Net Minority Interest","Total Current Liabilities","Stockholders Equity","Cash And Cash Equivalents","Long Term Debt","Total Debt","Net Debt","Property Plant Equipment","Inventory","Receivables","Minority Interest"])
except: out["balanceSheets"] = []
try: out["cashFlows"] = extract_df(t.cashflow, ["Operating Cash Flow","Capital Expenditure","Free Cash Flow","Depreciation And Amortization","Change In Working Capital"])
except: out["cashFlows"] = []
print(json.dumps(out))
`);

  if (data.error) {
    return { ok: false, error: data.error, data };
  }

  cache?.set(cacheKey, data, 3600);
  return { ok: true, data };
}

async function pullStockPrice(ticker, params, cache) {
  const range = (params.range || "1y").replace(/[^a-z0-9]/gi, "");
  const interval = (params.interval || "1d").replace(/[^a-z0-9]/gi, "");
  const cacheKey = `yahoo:price:${ticker}:${range}:${interval}`;

  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await runYfinance(`
import yfinance as yf, json
t = yf.Ticker("${ticker}")
h = t.history(period="${range}", interval="${interval}")
if h.empty:
    print(json.dumps({"error":"no price data","ticker":"${ticker}"}))
else:
    ps = [{"date":i.strftime("%Y-%m-%d"),"open":round(r["Open"],2),"high":round(r["High"],2),"low":round(r["Low"],2),"close":round(r["Close"],2),"volume":int(r["Volume"])} for i,r in h.iterrows()]
    print(json.dumps({"ticker":"${ticker}","count":len(ps),"prices":ps}))
`);

  if (data.error) {
    return { ok: false, error: data.error, data };
  }

  cache?.set(cacheKey, data, 3600);
  return { ok: true, data };
}

export async function pull(ctx) {
  const { action, params, cache } = ctx;
  const ticker = sanitizeTicker(params?.ticker);

  if (!ticker) {
    return { ok: false, error: "缺少 ticker 参数", code: "MISSING_PARAM" };
  }

  if (action === "stock_info") {
    return pullStockInfo(ticker, cache);
  }

  if (action === "stock_price") {
    return pullStockPrice(ticker, params, cache);
  }

  return { ok: false, error: `未知 action: ${action}`, code: "UNKNOWN_ACTION" };
}
