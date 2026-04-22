/**
 * ウォッチリスト管理（Day 1-3: .envベース）
 *
 * .env.local に WATCHLIST_CODES=7203,9984,6758 形式で設定。
 * Day 4-7 polish でSupabaseのwatchlistsテーブルに移行予定。
 */

/**
 * 環境変数からウォッチリストの証券コード配列を返す
 * 例: "7203, 9984, 6758" → ["7203", "9984", "6758"]
 */
export function getWatchlistCodes(): string[] {
  const raw = process.env.WATCHLIST_CODES ?? "";
  if (!raw.trim()) return [];

  // カンマ・スペース・改行のいずれでも区切れる（Vercel UIのコンマ入力問題に対応）
  return raw
    .split(/[,\s\n]+/)
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

/**
 * 証券コードがウォッチリストに含まれるか判定
 */
export function isWatched(companyCode: string, watchlist: string[]): boolean {
  return watchlist.includes(companyCode.trim());
}
