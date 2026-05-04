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

import type { EdinetCompany, EdinetEarnings, EdinetEvent, IrSection } from "@/types";
import { formatMillionJpy } from "@/lib/summary";

const EDINET_MCP_URL = "https://edinetdb.jp/mcp";

// リクエストIDのカウンター（セッション内で一意であれば十分）
let requestId = 1;

// ── セッションキャッシュ（ポーリングサイクル内で再利用）────────────
let cachedSession: { id: string | null; expiresAt: number } | null = null;

// ── 証券コード → EDINETコード キャッシュ ─────────────────────────
const edinetCodeCache = new Map<string, string>();

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

// ── セッションID取得（キャッシュ再利用） ─────────────────────────

async function getSession(): Promise<string | null> {
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession.id;
  }
  const id = await initSession();
  cachedSession = { id, expiresAt: Date.now() + 50 * 60 * 1000 };
  return id;
}

// ── 証券コード → EDINETコード変換 ───────────────────────────────

/**
 * 証券コード（4桁）→ EDINETコード変換
 * search_companies で解決し、結果をキャッシュ
 */
export async function resolveEdinetCode(
  secCode: string
): Promise<string | null> {
  if (edinetCodeCache.has(secCode)) return edinetCodeCache.get(secCode)!;

  const sessionId = await getSession();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool(
      "search_companies",
      { query: secCode, limit: 1 },
      sessionId
    );
    if (!data) return null;

    const results = Array.isArray(data)
      ? data
      : (data.results ?? data.companies ?? []);
    if (results.length === 0) return null;

    const code: string | undefined =
      results[0]?.edinetCode ?? results[0]?.edinet_code;
    if (code) edinetCodeCache.set(secCode, code);
    return code ?? null;
  } catch (err) {
    console.warn(`[edinet] resolveEdinetCode(${secCode}) failed:`, err);
    return null;
  }
}

// ── get_events: 企業イベント取得 ────────────────────────────────

/**
 * 企業イベントを取得（TDNet/EDINET/JPX 統合）
 * sec_code でフィルタ可能。指定なしで全銘柄を返す。
 */
export async function getEvents(options?: {
  secCode?: string;
  since?: string;
  until?: string;
  eventCategory?: string;
  severity?: string;
  limit?: number;
}): Promise<EdinetEvent[]> {
  const sessionId = await getSession();

  const args: Record<string, unknown> = {};
  if (options?.secCode) args.sec_code = options.secCode;
  if (options?.since) args.since = options.since;
  if (options?.until) args.until = options.until;
  if (options?.eventCategory) args.event_category = options.eventCategory;
  if (options?.severity) args.severity = options.severity;
  if (options?.limit) args.limit = options.limit;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool("get_events", args, sessionId);
    if (!data) return [];

    const events = Array.isArray(data)
      ? data
      : (data.events ?? data.results ?? []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return events.map((e: any) => ({
      secCode: String(e.sec_code ?? e.secCode ?? ""),
      edinetCode: String(e.edinet_code ?? e.edinetCode ?? ""),
      companyName: String(e.company_name ?? e.companyName ?? ""),
      eventType: String(e.event_type ?? e.eventType ?? ""),
      eventCategory: String(e.event_category ?? e.eventCategory ?? ""),
      severity: (e.severity as EdinetEvent["severity"]) ?? "medium",
      title: String(e.title ?? e.event_title ?? ""),
      publishedAt: String(
        e.published_at ?? e.publishedAt ?? e.event_date ?? ""
      ),
      source: String(e.source ?? "edinet"),
    }));
  } catch (err) {
    console.warn("[edinet] getEvents failed:", err);
    return [];
  }
}

// ── get_earnings: 決算短信データ取得（修正版） ──────────────────

/**
 * 企業の決算短信データを取得
 * 証券コード（4桁）→ EDINETコードに変換してから取得する。
 */
export async function getEarnings(
  secCode: string
): Promise<EdinetEarnings | null> {
  const edinetCode = await resolveEdinetCode(secCode);
  if (!edinetCode) {
    console.warn(`[edinet] getEarnings: EDINETコード未解決 (${secCode})`);
    return null;
  }

  const sessionId = await getSession();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool(
      "get_earnings",
      { edinet_code: edinetCode },
      sessionId
    );

    if (!data) return null;

    // get_earnings は配列を返す場合がある
    const entries = Array.isArray(data)
      ? data
      : (data.earnings ?? data.results ?? [data]);
    if (entries.length === 0) return null;

    const latest = entries[0];

    // 来期予想テキストを構築（百万円 → 読みやすい金額に変換）
    const forecastParts: string[] = [];
    if (latest.forecastRevenue != null)
      forecastParts.push(`売上予想: ${formatMillionJpy(latest.forecastRevenue)}`);
    if (latest.forecastOperatingIncome != null)
      forecastParts.push(
        `営業利益予想: ${formatMillionJpy(latest.forecastOperatingIncome)}`
      );
    if (latest.forecastNetIncome != null)
      forecastParts.push(`純利益予想: ${formatMillionJpy(latest.forecastNetIncome)}`);
    if (latest.forecastEps != null)
      forecastParts.push(`EPS予想: ${latest.forecastEps}円`);

    return {
      companyCode: secCode,
      companyName: latest.name ?? latest.company_name ?? "",
      fiscalYear: latest.title ?? latest.fiscalYearEnd ?? latest.fiscal_year ?? "",
      revenue: latest.revenue ?? undefined,
      revenueYoy: latest.revenueChange ?? latest.revenue_yoy ?? undefined,
      operatingProfit: latest.operatingIncome ?? latest.operating_income ?? undefined,
      operatingProfitYoy:
        latest.operatingIncomeChange ?? latest.operating_income_change ?? undefined,
      netProfit: latest.netIncome ?? latest.net_income ?? undefined,
      eps: latest.eps ?? undefined,
      forecast:
        forecastParts.length > 0
          ? forecastParts.join("、")
          : undefined,
      pdfUrl: latest.pdfUrl ?? latest.pdf_url ?? undefined,
    };
  } catch (err) {
    console.warn(`[edinet] getEarnings(${secCode}) failed:`, err);
    return null;
  }
}

// ── get_ir_sections: IR資料セクション取得 ───────────────────────

/**
 * IR資料セクションを取得（最新PDFの内容）
 * 中期経営計画・統合報告書などの戦略コンテンツを返す
 */
export async function getIrSections(
  secCode: string,
  options?: { latestN?: number; pdfType?: string }
): Promise<IrSection[]> {
  const edinetCode = await resolveEdinetCode(secCode);
  if (!edinetCode) return [];

  const sessionId = await getSession();

  try {
    const args: Record<string, unknown> = { edinet_code: edinetCode };
    if (options?.latestN) args.latest_n = options.latestN;
    else args.latest_n = 1;
    if (options?.pdfType) args.pdf_type = options.pdfType;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool(
      "get_ir_sections_by_company",
      args,
      sessionId
    );
    if (!data) return [];

    const sections = Array.isArray(data)
      ? data
      : (data.sections ?? data.results ?? []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return sections.map((s: any) => ({
      sectionType: String(s.section_type ?? s.sectionType ?? ""),
      title: String(s.heading ?? s.title ?? s.section_title ?? ""),
      content: String(s.body ?? s.content ?? s.text ?? ""),
      pdfType: (s.pdf_type ?? s.pdfType) as string | undefined,
      pdfUrl: (s.pdf_url ?? s.pdfUrl) as string | undefined,
      pdfTitle: (s.pdf_title ?? s.pdfTitle) as string | undefined,
      publishedAt: (s.pdf_discovered_at ?? s.published_at) as string | undefined,
    }));
  } catch (err) {
    console.warn(`[edinet] getIrSections(${secCode}) failed:`, err);
    return [];
  }
}

// ── get_company: 企業基本情報取得（修正版） ─────────────────────

/**
 * 企業の基本情報を取得
 * 証券コード（4桁）→ EDINETコードに変換してから取得する。
 */
export async function getCompany(
  secCode: string
): Promise<EdinetCompany | null> {
  const edinetCode = await resolveEdinetCode(secCode);
  if (!edinetCode) return null;

  const sessionId = await getSession();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await callTool(
      "get_company",
      { edinet_code: edinetCode },
      sessionId
    );

    if (!data) return null;

    return {
      companyCode: secCode,
      companyName: data.name ?? data.company_name ?? "",
      industry: data.industry ?? data.sector ?? "",
      marketCap: data.market_cap ?? data.marketCap ?? undefined,
      healthScore: data.healthScore ?? data.health_score ?? undefined,
      roe: data.roe ?? undefined,
      per: data.per ?? undefined,
      dividendYield: data.dividendYield ?? data.dividend_yield ?? undefined,
      textBlocksUrl: data.textBlocksUrl ?? data.text_blocks_url ?? undefined,
    };
  } catch (err) {
    console.warn(`[edinet] getCompany(${secCode}) failed:`, err);
    return null;
  }
}
