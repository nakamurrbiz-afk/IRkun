/**
 * Discord Webhook 通知クライアント
 *
 * JP: EDINETデータを構造化Embedで通知
 * Overseas: FMPデータを英語Embedで通知
 */

import type { DiscordNotification, EdinetEarnings, EdinetCompany } from "@/types";
import type { FmpCompanyProfile } from "@/types/overseas";
import type { EdgarFinancials } from "@/lib/edgar";
import { formatMillionJpy, formatSign } from "@/lib/summary";
import { formatUsd } from "@/lib/format-usd";

const SENTIMENT_COLORS = {
  positive: 0x00c851, // 緑
  negative: 0xff4444, // 赤
  neutral: 0x33b5e5, // 青
} as const;

function getDocTypeEmoji(docType: string, market?: string): string {
  if (market === "overseas") {
    if (docType.includes("Earnings")) return "📊";
    if (docType.includes("Press")) return "📰";
    return "📋";
  }
  if (docType.includes("決算") || docType.includes("業績")) return "📊";
  if (docType.includes("配当")) return "💰";
  if (docType.includes("合併") || docType.includes("買収")) return "🤝";
  if (docType.includes("人事") || docType.includes("役員")) return "👤";
  if (docType.includes("リスク") || docType.includes("訂正")) return "⚠️";
  return "📋";
}

// ── JP 用フィールドビルダー ─────────────────────────────────────

function buildEarningsField(e: EdinetEarnings): string {
  const parts: string[] = [];

  if (e.revenue != null) {
    const yoy =
      e.revenueYoy != null ? ` (${formatSign(e.revenueYoy)}%)` : "";
    parts.push(`売上高: **${formatMillionJpy(e.revenue)}**${yoy}`);
  }
  if (e.operatingProfit != null) {
    const yoy =
      e.operatingProfitYoy != null
        ? ` (${formatSign(e.operatingProfitYoy)}%)`
        : "";
    parts.push(`営業利益: **${formatMillionJpy(e.operatingProfit)}**${yoy}`);
  }
  if (e.netProfit != null) {
    parts.push(`純利益: **${formatMillionJpy(e.netProfit)}**`);
  }
  if (e.eps != null) {
    parts.push(`EPS: **${e.eps}円**`);
  }

  return parts.length > 0 ? parts.join("\n") : "データなし";
}

function buildForecastField(e: EdinetEarnings): string | null {
  if (!e.forecast) return null;
  return e.forecast;
}

function buildCompanyField(c: EdinetCompany): string {
  const parts: string[] = [];

  if (c.industry) parts.push(`業種: ${c.industry}`);
  if (c.healthScore != null) parts.push(`財務健全性: ${c.healthScore}/100`);
  if (c.roe != null) parts.push(`ROE: ${c.roe}%`);
  if (c.per != null) parts.push(`PER: ${c.per}倍`);
  if (c.dividendYield != null) parts.push(`配当利回り: ${c.dividendYield}%`);

  return parts.length > 0 ? parts.join("\n") : "データなし";
}

function buildLinksField(
  earnings?: EdinetEarnings,
  company?: EdinetCompany,
  docUrl?: string,
  midtermPdfs?: { url: string; title: string }[],
): string {
  const links: string[] = [];

  if (docUrl) links.push(`[📄 開示原文](${docUrl})`);
  if (earnings?.pdfUrl) links.push(`[📑 決算短信PDF](${earnings.pdfUrl})`);
  if (company?.textBlocksUrl)
    links.push(`[📋 EDINET DB テキスト](${company.textBlocksUrl})`);
  if (midtermPdfs) {
    for (const pdf of midtermPdfs) {
      links.push(`[📘 ${pdf.title}](${pdf.url})`);
    }
  }

  return links.length > 0 ? links.join("\n") : "";
}

// ── Overseas 用フィールドビルダー ───────────────────────────────

function buildEdgarEarningsField(edgar: EdgarFinancials): string {
  const parts: string[] = [];

  if (edgar.revenue != null) {
    parts.push(`Revenue: **${formatUsd(edgar.revenue)}**`);
  }
  if (edgar.operatingIncome != null) {
    parts.push(`Operating Income: **${formatUsd(edgar.operatingIncome)}**`);
  }
  if (edgar.netIncome != null) {
    parts.push(`Net Income: **${formatUsd(edgar.netIncome)}**`);
  }
  if (edgar.epsDiluted != null) {
    parts.push(`EPS (diluted): **$${edgar.epsDiluted.toFixed(2)}**`);
  }
  if (edgar.period) {
    parts.push(`Period: ${edgar.period}`);
  }

  return parts.length > 0 ? parts.join("\n") : "No data";
}

function buildOverseasProfileField(p: FmpCompanyProfile): string {
  const parts: string[] = [];

  if (p.sector) parts.push(`Sector: ${p.sector}`);
  if (p.industry) parts.push(`Industry: ${p.industry}`);
  if (p.mktCap != null) parts.push(`Market Cap: ${formatUsd(p.mktCap)}`);
  if (p.country) parts.push(`Country: ${p.country}`);
  if (p.exchange) parts.push(`Exchange: ${p.exchange}`);

  return parts.length > 0 ? parts.join("\n") : "No data";
}

function buildOverseasLinksField(
  profile?: FmpCompanyProfile,
  edgar?: EdgarFinancials,
  docUrl?: string,
): string {
  const links: string[] = [];
  const symbol = profile?.symbol;

  if (docUrl) links.push(`[📄 Filing](${docUrl})`);

  // SEC EDGAR リンク（CIK から構築）
  const cik = edgar?.cik ?? profile?.cik;
  if (cik) {
    const cleanCik = cik.replace(/^0+/, "");
    links.push(`[🏛 SEC EDGAR](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cleanCik}&type=10-&dateb=&owner=include&count=5)`);
  }

  // Yahoo Finance 決算ページ
  if (symbol) {
    links.push(`[📊 Yahoo Finance](https://finance.yahoo.com/quote/${symbol}/financials/)`);
  }

  return links.length > 0 ? links.join("\n") : "";
}

// ── メイン通知関数 ───────────────────────────────────────────────

/**
 * Discord Webhook にIRアラートを送信
 */
export async function sendDiscordNotification(
  notification: DiscordNotification,
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is not set");

  const { disclosure, summary } = notification;
  const isOverseas = disclosure.market === "overseas";

  const emoji = getDocTypeEmoji(disclosure.docType, disclosure.market);
  const color = SENTIMENT_COLORS[summary.sentiment];

  // ── Embed構築 ──────────────────────────────────────────────────
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (isOverseas) {
    // Overseas フォーマット
    const { overseasProfile, edgarFinancials } = notification;

    if (edgarFinancials) {
      fields.push({
        name: `📈 Financials (${edgarFinancials.period || "Latest"})`,
        value: buildEdgarEarningsField(edgarFinancials),
      });
    }

    if (overseasProfile) {
      fields.push({
        name: "🏢 Company Info",
        value: buildOverseasProfileField(overseasProfile),
        inline: true,
      });
    }

    const linksText = buildOverseasLinksField(
      overseasProfile,
      edgarFinancials,
      disclosure.docUrl,
    );
    if (linksText) {
      fields.push({ name: "🔗 Links", value: linksText });
    }
  } else {
    // JP フォーマット（従来どおり）
    const { earnings, company, midtermPdfs } = notification;

    if (earnings) {
      fields.push({
        name: `📈 業績（${earnings.fiscalYear || "直近"}）`,
        value: buildEarningsField(earnings),
      });
      const forecast = buildForecastField(earnings);
      if (forecast) {
        fields.push({ name: "📊 通期予想", value: forecast });
      }
    }

    if (company) {
      fields.push({
        name: "🏢 企業情報",
        value: buildCompanyField(company),
        inline: true,
      });
    }

    const linksText = buildLinksField(earnings, company, disclosure.docUrl, midtermPdfs);
    if (linksText) {
      fields.push({ name: "🔗 リンク", value: linksText });
    }
  }

  // ── 共通 Embed ─────────────────────────────────────────────────
  const sourceLabel = isOverseas
    ? "FMP"
    : disclosure.source === "edinet"
      ? "EDINET"
      : "TDNet";

  const publishedDisplay = disclosure.publishedAt.toLocaleString(
    isOverseas ? "en-US" : "ja-JP",
    {
      timeZone: isOverseas ? "America/New_York" : "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  const payload = {
    embeds: [
      {
        color,
        author: {
          name: `${emoji} IR Alert｜${disclosure.companyName}（${disclosure.companyCode}）`,
        },
        title: disclosure.docTitle,
        description: isOverseas
          ? [
              `📅 **Date**: ${publishedDisplay} ET`,
              `🏷 **Type**: ${disclosure.docType}`,
              `📡 **Source**: ${sourceLabel}`,
            ].join("\n")
          : [
              `📅 **公開日時**: ${publishedDisplay}`,
              `🏷 **種別**: ${disclosure.docType}`,
              `📡 **ソース**: ${sourceLabel}`,
            ].join("\n"),
        fields,
        footer: {
          text: isOverseas
            ? "FMP data. Not investment advice."
            : "EDINET DB データに基づく通知です。投資判断はご自身の責任で行ってください。",
        },
        timestamp: disclosure.publishedAt.toISOString(),
        ...(disclosure.docUrl ? { url: disclosure.docUrl } : {}),
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Discord Webhook failed: ${res.status} ${res.statusText} — ${body}`,
    );
  }
}
