/**
 * EDINET DB MCP API クライアント（JSON-RPC 2.0）
 *
 * エンドポイント: https://edinetdb.jp/mcp
 * - initialize は認証不要
 * - tools/call は Authorization: Bearer が必要
 * - セッションID（Mcp-Session-Id）は1時間有効
 *
 * 使用するのはウォッチリストマッチ時のみ。Freeプラン 100req/日 を守る。
 */

import type { EdinetCompany, EdinetEarnings } from "@/types";

const EDINET_MCP_URL = "https://edinetdb.jp/mcp";

// リクエストIDのカウンター（セッション内で一意であれば十分）
let requestId = 1;

/**
 * MCPセッションを初期化してセッションIDを取得する
 * Vercel の関数は stateless のためリクエストごとに初期化する
 */
async function initSession(): Promise<string | null> {
  const res = await fetch(EDINET_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "ir-alert-app", version: "1.0" },
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.warn("[edinet] initialize failed:", res.status);
    return null;
  }

  // セッションIDはレスポンスヘッダーに含まれる
  return res.headers.get("Mcp-Session-Id");
}

/**
 * EDINET DB MCP tools/call を実行する汎用関数
 */
async function callTool(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, unknown>,
  sessionId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) throw new Error("EDINET_API_KEY is not set");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(EDINET_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId++,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`[edinet] ${toolName} failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // JSON-RPC エラーチェック
  if (json.error) {
    throw new Error(`[edinet] ${toolName} error: ${JSON.stringify(json.error)}`);
  }

  // tools/call のレスポンスは result.content[0].text に JSON 文字列が入る
  const content = json.result?.content;
  if (!content || !Array.isArray(content) || content.length === 0) {
    return null;
  }

  const text = content[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text; // JSONでなければテキストのまま返す
  }
}

/**
 * 企業の決算短信データを取得（TDNet速報）
 * 決算系の開示にマッチした際に呼び出す。
 */
export async function getEarnings(
  companyCode: string
): Promise<EdinetEarnings | null> {
  const sessionId = await initSession();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool(
      "get_earnings",
      { company_code: companyCode },
      sessionId
    );

    if (!data) return null;

    return {
      companyCode,
      companyName: data.company_name ?? data.companyName ?? "",
      fiscalYear: data.fiscal_year ?? data.fiscalYear ?? "",
      revenue: data.revenue ?? data.sales ?? undefined,
      revenueYoy: data.revenue_yoy ?? data.salesYoy ?? undefined,
      operatingProfit: data.operating_profit ?? data.operatingProfit ?? undefined,
      operatingProfitYoy:
        data.operating_profit_yoy ?? data.operatingProfitYoy ?? undefined,
      netProfit: data.net_profit ?? data.netProfit ?? undefined,
      eps: data.eps ?? undefined,
      forecast: data.forecast ?? data.outlook ?? undefined,
    };
  } catch (err) {
    // EDINET DBにまだデータがない場合は null を返して続行
    console.warn(`[edinet] getEarnings(${companyCode}) failed:`, err);
    return null;
  }
}

/**
 * 企業の基本情報を取得
 */
export async function getCompany(
  companyCode: string
): Promise<EdinetCompany | null> {
  const sessionId = await initSession();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool(
      "get_company",
      { company_code: companyCode },
      sessionId
    );

    if (!data) return null;

    return {
      companyCode,
      companyName: data.company_name ?? data.companyName ?? "",
      industry: data.industry ?? data.sector ?? "",
      marketCap: data.market_cap ?? data.marketCap ?? undefined,
      healthScore: data.health_score ?? data.healthScore ?? undefined,
    };
  } catch (err) {
    console.warn(`[edinet] getCompany(${companyCode}) failed:`, err);
    return null;
  }
}
