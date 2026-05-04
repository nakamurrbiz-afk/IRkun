/**
 * POST /api/cron/poll
 *
 * GitHub Actions Cron から30分ごとに呼び出されるメインポーリングエンドポイント。
 * 処理フロー:
 *   1. Supabase からウォッチリストを取得（未設定時は .env にフォールバック）
 *   2a. やのしん TDNet API で直近35分の開示を取得
 *   2b. EDINET DB get_events で当日のイベントを取得（critical/high）
 *   2c. 両ソースをマージ
 *   3. ウォッチリストとマッチング
 *   4. 各マッチに対して: 重複チェック → EDINET補完(決算+企業情報) → 構造化サマリー → Discord通知 → DB保存
 *   5. 処理結果を JSON で返す
 *
 * セキュリティ: x-cron-secret ヘッダーで認証
 */

import { NextRequest, NextResponse } from "next/server";
import { getWatchlistCodes, isWatched } from "@/lib/watchlist";
import { getRecentDisclosures, isEarningsType } from "@/lib/tdnet";
import { getEarnings, getEvents, getCompany, getIrSections } from "@/lib/edinet";
import { buildIrSummary } from "@/lib/summary";
import { sendDiscordNotification } from "@/lib/discord";
import { supabase } from "@/lib/supabase";
import type { PollResult, TDNetDisclosure } from "@/types";

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

  // ── Step 2a: TDNet から直近35分の開示を取得 ──────────────────────
  let tdnetDisclosures: TDNetDisclosure[] = [];
  try {
    tdnetDisclosures = await getRecentDisclosures();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`TDNet: ${msg}`);
  }

  // ── Step 2b: EDINET DB から当日のイベントを取得 ──────────────────
  let edinetDisclosures: TDNetDisclosure[] = [];
  try {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    const events = await getEvents({
      since: yesterday,
      severity: "critical,high",
      limit: 100,
    });
    edinetDisclosures = events
      .filter((e) => e.secCode && isWatched(e.secCode, watchlist))
      .map((e) => ({
        companyCode: e.secCode,
        companyName: e.companyName,
        docTitle: e.title,
        docType: e.eventType || e.eventCategory,
        publishedAt: new Date(e.publishedAt),
        docUrl: "",
        source: "edinet" as const,
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`EDINET: ${msg}`);
  }

  // ── Step 2c: 両ソースをマージ ───────────────────────────────────
  const allDisclosures: TDNetDisclosure[] = [
    ...tdnetDisclosures.map((d) => ({ ...d, source: "tdnet" as const })),
    ...edinetDisclosures,
  ];
  result.totalDisclosures = allDisclosures.length;

  // ── Step 3: ウォッチリストとマッチング ───────────────────────────
  const matched = allDisclosures.filter((d) =>
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

      // 決算系の開示なら EDINET DB で財務データ + 企業情報を補完
      const isEarnings = isEarningsType(disclosure.docType);
      const earnings = isEarnings
        ? await getEarnings(disclosure.companyCode)
        : null;
      const company = await getCompany(disclosure.companyCode);

      // 中期経営計画 PDF を取得（非致命的）
      let midtermPdfs: { url: string; title: string }[] | undefined;
      try {
        const sections = await getIrSections(disclosure.companyCode, {
          pdfType: "midterm",
          latestN: 1,
        });
        const seen = new Set<string>();
        const pdfs: { url: string; title: string }[] = [];
        for (const s of sections) {
          if (s.pdfUrl && !seen.has(s.pdfUrl)) {
            seen.add(s.pdfUrl);
            pdfs.push({ url: s.pdfUrl, title: s.pdfTitle || "中期経営計画" });
          }
        }
        if (pdfs.length > 0) midtermPdfs = pdfs;
      } catch (err) {
        console.warn(
          `[poll] midterm PDF fetch failed for ${disclosure.companyCode}:`,
          err,
        );
      }

      // EDINET データから構造化サマリーを生成（Claude API 不要）
      const summary = buildIrSummary(disclosure, earnings, company);

      // Discord Webhook に通知
      await sendDiscordNotification({
        disclosure,
        summary,
        earnings: earnings ?? undefined,
        company: company ?? undefined,
        midtermPdfs,
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
