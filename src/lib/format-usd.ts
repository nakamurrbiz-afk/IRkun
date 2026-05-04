/**
 * USD / グローバル通貨のフォーマッター
 */

/**
 * USD金額を読みやすい表記に変換
 * $1.2T / $340B / $15.2M / $1,234
 */
export function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/**
 * 成長率（小数）を符号付きパーセント表記に変換
 * 0.08 → "+8.0%", -0.12 → "-12.0%"
 */
export function formatGrowth(decimal: number): string {
  const pct = decimal * 100;
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}
