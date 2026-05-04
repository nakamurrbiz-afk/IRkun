/**
 * POST /api/cron/poll
 *
 * GitHub Actions Cron から30分ごとに呼び出されるメインポーリングエンドポイント。
 * 処理フロー:
 *   1. Supabase からウォッチリストを取得（未設定時は .env にフォールバック）
 *   2. JP: TDNet + EDINET DB でマッチング → 通知
 *   3. Overseas: FMP earnings calendar でマッチング → 通知
 *   4. 処理結果を JSON で返す
 *
 * セキュリティ: x-cron-secret ヘッダーで認証
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getWatchlistCodes,
  getWatchlistEntries,
  isWatched,
  splitByMarket,
} from "@/lib/watchlist";
import type { WatchlistEntry } from "@/lib/watchlist";
import { getRecentDisclosures, isEarningsType } from "@/lib/tdnet";
import { getEarnings, getEvents, getCompany, getIrSections } from "@/lib/edinet";
import { getProfile } from "@/lib/fmp";
import { getEdgarFinancials } from "@/lib/edgar";
import { buildIrSummary, buildOverseasSummary } from "@/lib/summary";
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
  let entries: WatchlistEntry[] = [];
  try {
    const { data, error } = await supabase
      .from("watchlists")
      .select("company_code, market");

    if (!error && data && data.length > 0) {
      entries = data.map((row) => ({
        companyCode: row.company_code,
        market: row.market ?? "jp",
      }));
    } else {
      entries = getWatchlistEntries();
    }
  } catch {
    entries = getWatchlistEntries();
  }

  if (entries.length === 0) {
    return NextResponse.json({
      ...result,
      message: "ウォッチリストが空です。管理画面から銘柄を追加してください。",
    });
  }

  const { jp: jpEntries, overseas: overseasEntries } = splitByMarket(entries);
  const jpWatchlist = jpEntries.map((e) => e.companyCode);

  // ══════════════════════════════════════════════════════════════
  // JP パイプライン（従来どおり）
  // ══════════════════════════════════════════════════════════════

  if (jpWatchlist.length > 0) {
    // ── Step 2a: TDNet から直近35分の開示を取得 ────────────────────
    let tdnetDisclosures: TDNetDisclosure[] = [];
    try {
      tdnetDisclosures = await getRecentDisclosures();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`TDNet: ${msg}`);
    }

    // ── Step 2b: EDINET DB から当日のイベントを取得 ────────────────
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
        .filter((e) => e.secCode && isWatched(e.secCode, jpWatchlist))
        .map((e) => ({
          companyCode: e.secCode,
          companyName: e.companyName,
          docTitle: e.title,
          docType: e.eventType || e.eventCategory,
          publishedAt: new Date(e.publishedAt),
          docUrl: "",
          source: "edinet" as const,
          market: "jp" as const,
        }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`EDINET: ${msg}`);
    }

    // ── Step 2c: 両ソースをマージ ─────────────────────────────────
    const allJpDisclosures: TDNetDisclosure[] = [
      ...tdnetDisclosures.map((d) => ({ ...d, source: "tdnet" as const, market: "jp" as const })),
      ...edinetDisclosures,
    ];
    result.totalDisclosures += allJpDisclosures.length;

    // ── Step 3: ウォッチリストとマッチング ─────────────────────────
    const matched = allJpDisclosures.filter((d) =>
      isWatched(d.companyCode, jpWatchlist),
    );
    result.matchedCount += matched.length;

    // ── Step 4: 各マッチを処理 ────────────────────────────────────
    for (const disclosure of matched) {
      try {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("company_code", disclosure.companyCode)
          .eq("market", "jp")
          .eq("doc_title", disclosure.docTitle)
          .gte("published_at", disclosure.publishedAt.toISOString())
          .maybeSingle();

        if (existing) continue;

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
          console.warn(`[poll] midterm PDF failed for ${disclosure.companyCode}:`, err);
        }

        const summary = buildIrSummary(disclosure, earnings, company);

        await sendDiscordNotification({
          disclosure,
          summary,
          earnings: earnings ?? undefined,
          company: company ?? undefined,
          midtermPdfs,
        });

        await supabase.from("notifications").insert({
          company_code: disclosure.companyCode,
          company_name: disclosure.companyName,
          market: "jp",
          doc_title: disclosure.docTitle,
          doc_type: disclosure.docType,
          doc_url: disclosure.docUrl,
          published_at: disclosure.publishedAt.toISOString(),
          summary: summary.lines.join("\n"),
        });

        result.notifiedCount++;
        if (matched.length > 1) await sleep(500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`[JP:${disclosure.companyCode}] ${msg}`);
        console.error("[poll] JP notification error:", msg);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Overseas パイプライン（FMP）
  // 各 watched symbol の最新 income-statement filingDate で新規決算を検知
  // ══════════════════════════════════════════════════════════════

  if (overseasEntries.length > 0 && process.env.FMP_API_KEY) {
    for (const entry of overseasEntries) {
      const symbol = entry.companyCode.toUpperCase();
      try {
        // FMP Profile で CIK を取得
        const profile = await getProfile(symbol);
        if (!profile?.cik) {
          console.warn(`[poll] No CIK for ${symbol}, skipping EDGAR`);
          continue;
        }

        // SEC EDGAR で最新四半期決算を取得
        const edgar = await getEdgarFinancials(profile.cik);
        if (!edgar?.filedDate) continue;

        // filedDate + period ベースで重複チェック
        const docTitle = `Earnings: ${symbol} ${edgar.period}`;
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("company_code", symbol)
          .eq("market", "overseas")
          .eq("doc_title", docTitle)
          .maybeSingle();

        if (existing) continue;

        // 新規決算 → 通知
        result.matchedCount++;

        const disclosure: TDNetDisclosure = {
          companyCode: symbol,
          companyName: profile.companyName ?? symbol,
          docTitle,
          docType: "Earnings Release",
          publishedAt: new Date(edgar.filedDate),
          docUrl: "",
          source: "fmp",
          market: "overseas",
        };

        const summary = buildOverseasSummary(disclosure, edgar, profile);

        await sendDiscordNotification({
          disclosure,
          summary,
          overseasProfile: profile,
          edgarFinancials: edgar,
        });

        await supabase.from("notifications").insert({
          company_code: symbol,
          company_name: profile.companyName ?? symbol,
          market: "overseas",
          doc_title: docTitle,
          doc_type: "Earnings Release",
          doc_url: "",
          published_at: new Date(edgar.filedDate).toISOString(),
          summary: summary.lines.join("\n"),
        });

        result.notifiedCount++;
        if (overseasEntries.length > 1) await sleep(500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`[Overseas:${symbol}] ${msg}`);
        console.error("[poll] Overseas notification error:", msg);
      }
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
