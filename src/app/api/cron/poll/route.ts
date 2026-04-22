/**
 * POST /api/cron/poll
 *
 * GitHub Actions Cron から30分ごとに呼び出されるメインポーリングエンドポイント。
 * 処理フロー:
 *   1. ウォッチリスト取得（.env）
 *   2. やのしん TDNet API で直近35分の開示を取得
 *   3. ウォッチリストとマッチング
 *   4. 各マッチに対して: EDINET補完 → Claude要約 → Discord通知
 *   5. 処理結果を JSON で返す
 *
 * セキュリティ: x-cron-secret ヘッダーで認証（GitHub Actions secrets と照合）
 */

import { NextRequest, NextResponse } from "next/server";
import { getWatchlistCodes, isWatched } from "@/lib/watchlist";
import { getRecentDisclosures, isEarningsType } from "@/lib/tdnet";
import { getEarnings } from "@/lib/edinet";
import { generateIrSummary } from "@/lib/claude";
import { sendDiscordNotification } from "@/lib/discord";
import type { PollResult } from "@/types";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── セキュリティ: Cron Secretの検証 ──────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const incoming = req.headers.get("x-cron-secret");

  if (cronSecret && incoming !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result: PollResult = {
    checkedAt: new Date(),
    totalDisclosures: 0,
    matchedCount: 0,
    notifiedCount: 0,
    errors: [],
  };

  // ── Step 1: ウォッチリスト取得 ────────────────────────────────────
  const watchlist = getWatchlistCodes();
  if (watchlist.length === 0) {
    return NextResponse.json({
      ...result,
      message: "WATCHLIST_CODES が未設定です。.env.local を確認してください。",
    });
  }

  // ── Step 2: TDNet から直近35分の開示を取得 ────────────────────────
  let disclosures;
  try {
    disclosures = await getRecentDisclosures();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`TDNet fetch error: ${msg}`);
    return NextResponse.json(result, { status: 500 });
  }

  result.totalDisclosures = disclosures.length;

  // ── Step 3: ウォッチリストとマッチング ───────────────────────────
  const matched = disclosures.filter((d) =>
    isWatched(d.companyCode, watchlist)
  );
  result.matchedCount = matched.length;

  if (matched.length === 0) {
    return NextResponse.json({
      ...result,
      message: `開示 ${result.totalDisclosures} 件を確認。ウォッチリストへのマッチなし。`,
    });
  }

  // ── Step 4: 各マッチを処理（EDINET補完 → Claude要約 → Discord通知）
  for (const disclosure of matched) {
    try {
      // 決算系の開示なら EDINET DB で財務データを補完
      const earnings = isEarningsType(disclosure.docType)
        ? await getEarnings(disclosure.companyCode)
        : null;

      // Claude API で3行サマリーを生成
      const summary = await generateIrSummary(disclosure, earnings);

      // Discord Webhook に通知
      await sendDiscordNotification({ disclosure, summary, earnings: earnings ?? undefined });

      result.notifiedCount++;

      // API レート制限への配慮: 連続する場合は少し待機
      if (matched.length > 1) {
        await sleep(500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorDetail = `[${disclosure.companyCode}] ${msg}`;
      result.errors.push(errorDetail);
      console.error("[poll] notification error:", errorDetail);
      // 1社のエラーで他社の通知を止めない
    }
  }

  return NextResponse.json({
    ...result,
    message: `✅ ${result.notifiedCount}/${result.matchedCount} 件を通知しました。`,
  });
}

/** ミリ秒待機 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
