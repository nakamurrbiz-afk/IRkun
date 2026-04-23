/**
 * Discord Webhook 通知クライアント
 *
 * むーさんのDiscordに開示情報とAIサマリーを送信する。
 */

import type { DiscordNotification } from "@/types";

/**
 * Discord Embed の色コード（センチメント別）
 */
const SENTIMENT_COLORS = {
  positive: 0x00c851, // 緑
  negative: 0xff4444, // 赤
  neutral: 0x33b5e5,  // 青
} as const;

/**
 * 開示の種別アイコンマップ
 */
function getDocTypeEmoji(docType: string): string {
  if (docType.includes("決算") || docType.includes("業績")) return "📊";
  if (docType.includes("配当")) return "💰";
  if (docType.includes("合併") || docType.includes("買収")) return "🤝";
  if (docType.includes("人事") || docType.includes("役員")) return "👤";
  if (docType.includes("リスク") || docType.includes("訂正")) return "⚠️";
  return "📋";
}

/**
 * Discord Webhook にIRアラートを送信
 *
 * @param notification - 開示情報 + AIサマリー
 */
export async function sendDiscordNotification(
  notification: DiscordNotification
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is not set");

  const { disclosure, summary } = notification;
  const emoji = getDocTypeEmoji(disclosure.docType);
  const color = SENTIMENT_COLORS[summary.sentiment];

  // 公開日時（JST）
  const publishedJst = disclosure.publishedAt.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Discord Embed フォーマット
  const payload = {
    embeds: [
      {
        color,
        author: {
          name: `${emoji} IRアラート｜${disclosure.companyName}（${disclosure.companyCode}）`,
        },
        title: disclosure.docTitle,
        description: [
          `📅 **公開日時**: ${publishedJst}`,
          `🏷 **種別**: ${disclosure.docType}`,
          "",
          "**📝 3行サマリー**",
          ...summary.lines.map((line) => `・${line}`),
          "",
          `[🔗 IRkunで確認する](https://irkun.vercel.app/)`,
        ].join("\n"),
        footer: {
          text: "⚠️ このサマリーはAI生成です。投資推奨ではありません。",
        },
        timestamp: disclosure.publishedAt.toISOString(),
        ...(disclosure.docUrl
          ? { url: disclosure.docUrl }
          : {}),
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
      `Discord Webhook failed: ${res.status} ${res.statusText} — ${body}`
    );
  }
}
