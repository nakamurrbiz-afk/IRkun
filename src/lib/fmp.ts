/**
 * Financial Modeling Prep (FMP) API クライアント
 *
 * Free tier: 250 req/day, 60+ exchanges
 * Endpoint: https://financialmodelingprep.com/stable/
 *
 * 海外企業のIR情報取得に使用。日本企業は従来どおり EDINET DB を使う。
 *
 * 検知方式: 各 watched symbol の最新 income-statement の filingDate が
 * 前回通知より新しければ新規決算としてアラートする。
 */

import type { FmpCompanyProfile } from "@/types/overseas";

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

// ── レート制限管理 ────────────────────────────────────────────
let dailyRequestCount = 0;
let lastResetDate = new Date().toISOString().slice(0, 10);
const DAILY_LIMIT = 200; // 250が上限だが余裕を持って200

function checkAndIncrementRate(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    dailyRequestCount = 0;
    lastResetDate = today;
  }
  if (dailyRequestCount >= DAILY_LIMIT) {
    console.warn(`[fmp] Daily rate limit reached (${DAILY_LIMIT} req/day)`);
    return false;
  }
  dailyRequestCount++;
  return true;
}

/**
 * FMP API汎用フェッチ関数（/stable/ エンドポイント用）
 *
 * /stable/ はクエリパラメータ形式（path params ではなく ?symbol=AAPL）
 */
async function fmpFetch<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error("FMP_API_KEY is not set");

  if (!checkAndIncrementRate()) return null;

  const url = new URL(`${FMP_BASE_URL}${path}`);
  url.searchParams.set("apikey", apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), { cache: "no-store" });

  if (!res.ok) {
    console.warn(`[fmp] ${path} failed: ${res.status} ${res.statusText}`);
    return null;
  }

  const json = await res.json();

  // FMP はエラー時に { "Error Message": "..." } を返す場合がある
  if (json && typeof json === "object" && !Array.isArray(json) && "Error Message" in json) {
    console.warn(`[fmp] ${path} error:`, json["Error Message"]);
    return null;
  }

  return json as T;
}

// ── 公開 API ─────────────────────────────────────────────────

/**
 * 企業プロフィールを取得
 */
export async function getProfile(symbol: string): Promise<FmpCompanyProfile | null> {
  const data = await fmpFetch<FmpCompanyProfile[]>("/profile", { symbol });
  return data?.[0] ?? null;
}


/**
 * 現在のリクエスト消費状況を取得（デバッグ用）
 */
export function getRequestStats(): { count: number; limit: number; date: string } {
  return { count: dailyRequestCount, limit: DAILY_LIMIT, date: lastResetDate };
}
