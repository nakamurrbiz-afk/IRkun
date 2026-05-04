/**
 * EDINET データから構造化サマリーを生成（Claude API 不要）
 *
 * 決算データ + 企業情報をそのまま整形して返す。
 * AI要約に頼らず、数値ファクトのみでDiscord通知を構成する。
 */

import type {
  TDNetDisclosure,
  EdinetEarnings,
  EdinetCompany,
  IrSummary,
} from "@/types";
import type { FmpCompanyProfile } from "@/types/overseas";
import type { EdgarFinancials } from "@/lib/edgar";
import { formatUsd } from "@/lib/format-usd";

/**
 * 百万円単位の値を読みやすい日本語金額に変換
 * 1兆円以上 → X.X兆円、1億円以上 → X億円、それ以下 → X百万円
 */
export function formatMillionJpy(millionYen: number): string {
  const abs = Math.abs(millionYen);
  const sign = millionYen < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}兆円`;
  }
  if (abs >= 100) {
    return `${sign}${Math.round(abs / 100).toLocaleString()}億円`;
  }
  return `${sign}${abs}百万円`;
}

/**
 * 前年比など符号付き数値に +/- プレフィックスを付与
 */
export function formatSign(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * EDINET データから IrSummary を構築（Claude 不要）
 */
export function buildIrSummary(
  disclosure: TDNetDisclosure,
  earnings: EdinetEarnings | null,
  company: EdinetCompany | null,
): IrSummary {
  const lines: string[] = [];

  // 業績データ
  if (earnings) {
    if (earnings.revenue != null) {
      const yoy =
        earnings.revenueYoy != null
          ? `（前年比 ${formatSign(earnings.revenueYoy)}%）`
          : "";
      lines.push(`売上高: ${formatMillionJpy(earnings.revenue)}${yoy}`);
    }
    if (earnings.operatingProfit != null) {
      const yoy =
        earnings.operatingProfitYoy != null
          ? `（前年比 ${formatSign(earnings.operatingProfitYoy)}%）`
          : "";
      lines.push(
        `営業利益: ${formatMillionJpy(earnings.operatingProfit)}${yoy}`,
      );
    }
    if (earnings.netProfit != null) {
      lines.push(`純利益: ${formatMillionJpy(earnings.netProfit)}`);
    }
    if (earnings.eps != null) {
      lines.push(`EPS: ${earnings.eps}円`);
    }
    if (earnings.forecast) {
      lines.push(`通期予想: ${earnings.forecast}`);
    }
  }

  // 企業情報
  if (company) {
    if (company.healthScore != null) {
      lines.push(`財務健全性: ${company.healthScore}/100`);
    }
    if (company.roe != null) {
      // APIは小数値(0.07)で返すため100倍してパーセント表示
      const roePercent = company.roe < 1 ? (company.roe * 100).toFixed(1) : company.roe.toFixed(1);
      lines.push(`ROE: ${roePercent}%`);
    }
  }

  // データが何もなかった場合のフォールバック
  if (lines.length === 0) {
    lines.push(`${disclosure.companyName}の開示情報を検出`);
  }

  // センチメント判定（前年比ベース）
  let sentiment: IrSummary["sentiment"] = "neutral";
  if (earnings) {
    const yoys = [earnings.revenueYoy, earnings.operatingProfitYoy].filter(
      (v): v is number => v != null,
    );
    if (yoys.length > 0) {
      const avg = yoys.reduce((a, b) => a + b, 0) / yoys.length;
      sentiment = avg > 5 ? "positive" : avg < -5 ? "negative" : "neutral";
    }
  }

  return {
    lines,
    sentiment,
    earnings: earnings ?? undefined,
    company: company ?? undefined,
  };
}

/**
 * 海外企業の FMP Profile + SEC EDGAR データから IrSummary を構築
 */
export function buildOverseasSummary(
  disclosure: TDNetDisclosure,
  edgar: EdgarFinancials | null,
  profile: FmpCompanyProfile | null,
): IrSummary {
  const lines: string[] = [];

  if (edgar) {
    if (edgar.revenue != null) {
      lines.push(`Revenue: **${formatUsd(edgar.revenue)}**`);
    }
    if (edgar.operatingIncome != null) {
      lines.push(`Operating Income: **${formatUsd(edgar.operatingIncome)}**`);
    }
    if (edgar.netIncome != null) {
      lines.push(`Net Income: **${formatUsd(edgar.netIncome)}**`);
    }
    if (edgar.epsDiluted != null) {
      lines.push(`EPS (diluted): **$${edgar.epsDiluted.toFixed(2)}**`);
    }
    if (edgar.period) {
      lines.push(`Period: ${edgar.period}`);
    }
  }

  if (profile) {
    if (profile.sector) lines.push(`Sector: ${profile.sector}`);
    if (profile.mktCap != null) lines.push(`Market Cap: ${formatUsd(profile.mktCap)}`);
    if (profile.country) lines.push(`Country: ${profile.country}`);
  }

  if (lines.length === 0) {
    lines.push(`${disclosure.companyName} disclosure detected`);
  }

  // センチメント判定（営業利益率ベース）
  let sentiment: IrSummary["sentiment"] = "neutral";
  if (edgar?.revenue && edgar?.operatingIncome) {
    const margin = edgar.operatingIncome / edgar.revenue;
    sentiment = margin > 0.15 ? "positive" : margin < 0 ? "negative" : "neutral";
  }

  return { lines, sentiment };
}
