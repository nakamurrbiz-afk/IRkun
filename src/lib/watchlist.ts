/**
 * ウォッチリスト管理
 *
 * Supabase watchlists テーブルから取得。
 * 未設定時は .env.local の WATCHLIST_CODES にフォールバック（JP のみ）。
 */

import type { Market } from "@/lib/supabase";

export interface WatchlistEntry {
  companyCode: string;
  market: Market;
}

/**
 * 環境変数からウォッチリストの証券コード配列を返す（JP のみ）
 * 例: "7203, 9984, 6758" → ["7203", "9984", "6758"]
 */
export function getWatchlistCodes(): string[] {
  const raw = process.env.WATCHLIST_CODES ?? "";
  if (!raw.trim()) return [];

  return raw
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

/**
 * 環境変数から WatchlistEntry[] を返す（JP のみ、フォールバック用）
 */
export function getWatchlistEntries(): WatchlistEntry[] {
  return getWatchlistCodes().map((code) => ({
    companyCode: code,
    market: "jp",
  }));
}

/**
 * 証券コードがウォッチリストに含まれるか判定
 */
export function isWatched(companyCode: string, watchlist: string[]): boolean {
  return watchlist.includes(companyCode.trim());
}

/**
 * WatchlistEntry[] を market で分割して返す
 */
export function splitByMarket(entries: WatchlistEntry[]): {
  jp: WatchlistEntry[];
  overseas: WatchlistEntry[];
} {
  const jp: WatchlistEntry[] = [];
  const overseas: WatchlistEntry[] = [];
  for (const entry of entries) {
    if (entry.market === "jp") jp.push(entry);
    else overseas.push(entry);
  }
  return { jp, overseas };
}
