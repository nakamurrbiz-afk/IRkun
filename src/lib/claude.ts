/**
 * Claude API クライアント（Anthropic SDK）
 *
 * IR開示情報を3行の日本語サマリーに変換する。
 * プロンプトキャッシュ（cache_control: ephemeral）を使い
 * 連続呼び出し時のトークンコストを削減。
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TDNetDisclosure, EdinetEarnings, IrSummary } from "@/types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-4-5";

// キャッシュ対象のシステムプロンプト（繰り返し呼び出し時にトークン節約）
const SYSTEM_PROMPT = `あなたは日本株の投資家向けIRアナリストです。
適時開示・決算短信の内容を受け取り、投資判断に役立つ3行サマリーを作成します。

## 出力ルール
- 必ず3行（箇条書き）で出力する
- 各行は「・」で始める
- 投資家が「で、何が起きたのか」を30秒で把握できる内容にする
- 数字（売上高・利益・前年比）は具体的に記載する
- 来期予想・ガイダンスがあれば3行目に含める
- JSONで返す: { "lines": ["行1", "行2", "行3"], "sentiment": "positive"|"negative"|"neutral" }
- sentimentは開示内容の全体的な印象で判定する

## 禁止事項
- 「〜と思われます」などの曖昧表現
- 投資推奨・売買指示的な表現
- 3行を超える出力`;

/**
 * IR開示情報から3行サマリーを生成
 *
 * @param disclosure - TDNet開示情報（タイトル・種別・会社名）
 * @param earnings   - EDINET決算データ（決算系のみ。なければnull）
 * @returns IrSummary（3行 + センチメント）
 */
export async function generateIrSummary(
  disclosure: TDNetDisclosure,
  earnings: EdinetEarnings | null
): Promise<IrSummary> {
  // ユーザーメッセージを構築
  const userContent = buildUserContent(disclosure, earnings);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // プロンプトキャッシュ: 同一セッション内の繰り返し呼び出しでsystem promptをキャッシュ
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";

  return parseResponse(text);
}

/**
 * ユーザーへの入力テキストを構築
 */
function buildUserContent(
  disclosure: TDNetDisclosure,
  earnings: EdinetEarnings | null
): string {
  const lines: string[] = [
    `【開示情報】`,
    `会社名: ${disclosure.companyName}（証券コード: ${disclosure.companyCode}）`,
    `種別: ${disclosure.docType}`,
    `タイトル: ${disclosure.docTitle}`,
    `公開日時: ${disclosure.publishedAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
  ];

  if (earnings) {
    lines.push(``, `【決算データ（EDINET DB）】`);
    if (earnings.fiscalYear) lines.push(`対象期間: ${earnings.fiscalYear}`);
    if (earnings.revenue != null) {
      const revStr = formatJpy(earnings.revenue);
      const yoyStr =
        earnings.revenueYoy != null
          ? ` (前年比 ${earnings.revenueYoy > 0 ? "+" : ""}${earnings.revenueYoy.toFixed(1)}%)`
          : "";
      lines.push(`売上高: ${revStr}${yoyStr}`);
    }
    if (earnings.operatingProfit != null) {
      const opStr = formatJpy(earnings.operatingProfit);
      const yoyStr =
        earnings.operatingProfitYoy != null
          ? ` (前年比 ${earnings.operatingProfitYoy > 0 ? "+" : ""}${earnings.operatingProfitYoy.toFixed(1)}%)`
          : "";
      lines.push(`営業利益: ${opStr}${yoyStr}`);
    }
    if (earnings.netProfit != null) {
      lines.push(`当期純利益: ${formatJpy(earnings.netProfit)}`);
    }
    if (earnings.eps != null) {
      lines.push(`EPS: ${earnings.eps.toFixed(2)}円`);
    }
    if (earnings.forecast) {
      lines.push(`来期予想: ${earnings.forecast}`);
    }
  }

  lines.push(``, `上記の内容を3行サマリーにしてください。`);
  return lines.join("\n");
}

/**
 * Claude の応答テキストをパースして IrSummary に変換
 * JSONパースに失敗した場合はフォールバックを返す
 */
function parseResponse(text: string): IrSummary {
  // JSONブロックを抽出（```json ... ``` または 裸のJSONを想定）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (
        Array.isArray(parsed.lines) &&
        parsed.lines.length === 3 &&
        parsed.lines.every((l: unknown) => typeof l === "string")
      ) {
        return {
          lines: parsed.lines as [string, string, string],
          sentiment: parsed.sentiment ?? "neutral",
        };
      }
    } catch {
      // パース失敗 → フォールバックへ
    }
  }

  // フォールバック: テキストを3行に分割して返す
  const rawLines = text
    .split("\n")
    .map((l) => l.replace(/^[・•\-*]\s*/, "").trim())
    .filter((l) => l.length > 0);

  const fallbackLines: [string, string, string] = [
    rawLines[0] ?? "開示内容を確認してください",
    rawLines[1] ?? "",
    rawLines[2] ?? "",
  ];

  return { lines: fallbackLines, sentiment: "neutral" };
}

/**
 * 円単位の数値を億円・兆円表記に変換
 */
function formatJpy(amount: number): string {
  if (Math.abs(amount) >= 1e12) {
    return `${(amount / 1e12).toFixed(2)}兆円`;
  }
  if (Math.abs(amount) >= 1e8) {
    return `${(amount / 1e8).toFixed(0)}億円`;
  }
  return `${amount.toLocaleString("ja-JP")}円`;
}
