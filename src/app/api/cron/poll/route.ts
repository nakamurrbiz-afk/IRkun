/**
 * POST /api/cron/poll
 *
 * GitHub Actions Cron から30分ごとに呼び出されるメインポーリングエンドポイント。
 * 処理フロー:
 *   1. Supabase からウォッチリストを取得（未設定時は .env にフォールバック）
 *   2. やのしん TDNet API で直近35分の開示を取得
 *   3. ウォッチリストとマッチング
 *   4. 各マッチに対して: 重複チェック → EDINET補完 → Claude要約 → Discord通知 → DB保存
 *   5. 処理結果を JSON で返す
 *
 * セキュリティ: x-cron-secret ヘッダーで認証
 */

import { NextRequest, NextResponse } from "next/server";
import { getWatchlistCodes, isWatched } from "@/lib/watchlist";
import { getRecentDisclosures, isEarningsType } from "@/lib/tdnet";
import { getEarnings } from "@/lib/edinet";
import { generateIrSummary } from "@/lib/claude";
import { sendDiscordNotification } from "@/lib/discord";
import { supabase } from "@/lib/supabase";
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

  // ── Step 1: ウォッチリスト取得（Supabase → .envフォールバック）────
  let watchlist: string[] = [];
  try {
    const { data, error } = await supabase
      .from("watchlists")
      .select("company_code");

    if (!error && data && data.length > 0) {
      watchlist = data.map((row) => row.company_code);
    } else {
      // Supabaseが空または未設定の場合は .env にフォールバック
      watchlist = getWatchlistCodes();
    }
  } catch {
    watchlist = getWatchlistCodes();
  }

  if (watchlist.length === 0) {
    return NextResponse.json({
      ...result,
      message: "ウォッチリストが空です。管理画面から銘柄を追加してください。",
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

  // ── Step 4: 各マッチを処理 ────────────────────────────────────────
  for (const disclosure of matched) {
    try {
      // 重複チェック: 同一開示がすでに通知済みかを確認
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("company_code", disclosure.companyCode)
        .eq("doc_title", disclosure.docTitle)
        .gte("published_at", disclosure.publishedAt.toISOString())
        .maybeSingle();

      if (existing) {
        // すでに通知済みなのでスキップ
        continue;
      }

      // 決算系の開示なら EDINET DB で財務データを補完
      const earnings = isEarningsType(disclosure.docType)
        ? await getEarnings(disclosure.companyCode)
        : null;

      // Claude API で3行サマリーを生成
      const summary = await generateIrSummary(disclosure, earnings);

      // Discord Webhook に通知
      await sendDiscordNotification({
        disclosure,
        summary,
        earnings: earnings ?? undefined,
      });

      // Supabase に通知履歴を保存（重複防止 + UI表示用）
      await supabase.from("notifications").insert({
        company_code: disclosure.companyCode,
        company_name: disclosure.companyName,
        doc_title: disclosure.docTitle,
        doc_type: disclosure.docType,
        doc_url: disclosure.docUrl,
        published_at: disclosure.publishedAt.toISOString(),
        summary: summary.lines.join("\n"),
      });

      result.notifiedCount++;

      if (matched.length > 1) {
        await sleep(500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorDetail = `[${disclosure.companyCode}] ${msg}`;
      result.errors.push(errorDetail);
      console.error("[poll] notification error:", errorDetail);
    }
  }

  return NextResponse.json({
    ...result,
    message: `✅ ${result.notifiedCount}/${result.matchedCount} 件を通知しました。`,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
