/**
 * やのしん TDNet 非公式 WEB-API クライアント
 *
 * エンドポイント: https://webapi.yanoshin.jp/webapi/tdnet/list/{YYYYMMDD}.xml
 * 認証不要・無料・無制限。ポーリングはすべてここに向ける。
 * （EDINET DB の 100req/日 制限を消費しない）
 */

import { parseStringPromise } from "xml2js";
import type { TDNetDisclosure } from "@/types";

const TDNET_BASE_URL = "https://webapi.yanoshin.jp/webapi/tdnet/list";

// 重複通知防止: 直近何分以内の開示を対象とするか（ポーリング間隔+5分のマージン）
const LOOKBACK_MINUTES = 35;

/**
 * 日付を YYYYMMDD 形式の文字列に変換
 */
function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * やのしん API から指定日の適時開示XMLを取得してパース
 */
async function fetchDisclosureXml(dateStr: string): Promise<unknown> {
  const url = `${TDNET_BASE_URL}/${dateStr}.xml`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ir-alert-app/1.0" },
    // Vercel Edge Cache を避けて常に最新を取得
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`TDNet API error: ${res.status} ${res.statusText} [${url}]`);
  }

  const xml = await res.text();
  return parseStringPromise(xml, { explicitArray: false, trim: true });
}

/**
 * パース結果から TDNetDisclosure[] に変換
 * やのしん APIのXMLスキーマに合わせて安全に読み取る
 */
function parseDisclosures(parsed: unknown): TDNetDisclosure[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = parsed as any;

  // XMLルート構造: <items><item>...</item></items> または類似
  const root = data?.items ?? data?.tdnet ?? data;
  let items = root?.item ?? root?.items?.item ?? [];

  // 単一要素の場合は配列化
  if (!Array.isArray(items)) {
    items = [items];
  }

  return items
    .filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any): TDNetDisclosure | null => {
      // フィールド名はやのしん APIの実際のXMLに依存。複数パターンを試みる
      const companyCode =
        item.company_code ?? item.companyCode ?? item.code ?? "";
      const companyName =
        item.company_name ?? item.companyName ?? item.name ?? "";
      const docTitle =
        item.title ?? item.doc_title ?? item.subject ?? "";
      const docType =
        item.doc_type ?? item.type ?? item.category ?? "適時開示";
      const publishedAtRaw =
        item.published_at ?? item.pubDate ?? item.date ?? item.time ?? "";
      const docUrl =
        item.url ?? item.link ?? item.pdf_url ?? "";

      if (!companyCode || !publishedAtRaw) return null;

      const publishedAt = new Date(publishedAtRaw);
      if (isNaN(publishedAt.getTime())) return null;

      return {
        companyCode: String(companyCode),
        companyName: String(companyName),
        docTitle: String(docTitle),
        docType: String(docType),
        publishedAt,
        docUrl: String(docUrl),
        xbrlUrl: item.xbrl_url ?? item.xbrlUrl ?? undefined,
      };
    })
    .filter((d: TDNetDisclosure | null): d is TDNetDisclosure => d !== null);
}

/**
 * 今日の適時開示を取得し、直近 LOOKBACK_MINUTES 以内のものだけを返す
 *
 * - GitHub Actions が30分ごとに呼ぶ
 * - 35分ウィンドウで各開示がほぼ1回だけ処理される
 * - Day 4-7 で Supabase の notifications テーブルに移行して完全排除
 */
export async function getRecentDisclosures(): Promise<TDNetDisclosure[]> {
  const now = new Date();
  const dateStr = toDateString(now);
  const cutoff = new Date(now.getTime() - LOOKBACK_MINUTES * 60 * 1000);

  let parsed: unknown;
  try {
    parsed = await fetchDisclosureXml(dateStr);
  } catch (err) {
    // 深夜など開示がない日はXMLが空の場合があるため警告のみ
    console.warn("[tdnet] fetch failed:", err);
    return [];
  }

  const all = parseDisclosures(parsed);

  // 直近 LOOKBACK_MINUTES 以内に公開されたものだけ
  return all.filter((d) => d.publishedAt >= cutoff);
}

/**
 * 開示の種別が決算系かどうかを判定（EDINET DB 補完の要否に使う）
 */
export function isEarningsType(docType: string): boolean {
  const earningsKeywords = ["決算", "業績", "配当", "earnings", "financial"];
  return earningsKeywords.some((kw) =>
    docType.toLowerCase().includes(kw.toLowerCase())
  );
}
