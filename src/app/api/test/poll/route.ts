/**
 * GET /api/test/poll?code=8802&notify=false
 *
 * フルパイプラインテスト:
 *   擬似開示 → EDINET enrichment → 構造化サマリー → (Discord通知) → (Supabase保存)
 *
 * パラメータ:
 *   code    — 証券コード（デフォルト: 8802）
 *   notify  — "true" で Discord通知 + Supabase保存を実行（デフォルト: false）
 *
 * 本番デプロイ前に削除すること。
 */

import { NextRequest, NextResponse } from "next/server";
import { getEarnings, getCompany, getIrSections } from "@/lib/edinet";
import { buildIrSummary } from "@/lib/summary";
import { sendDiscordNotification } from "@/lib/discord";
import { supabase } from "@/lib/supabase";
import type { TDNetDisclosure } from "@/types";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secCode = req.nextUrl.searchParams.get("code") ?? "8802";
  const shouldNotify = req.nextUrl.searchParams.get("notify") === "true";

  const steps: Record<string, unknown> = {};
  const errors: string[] = [];

  // Step 1: 企業情報取得（会社名を取得するため）
  let companyName = `証券コード ${secCode}`;
  try {
    const company = await getCompany(secCode);
    if (company?.companyName) companyName = company.companyName;
    steps.getCompany = company;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getCompany: ${msg}`);
  }

  // Step 2: 擬似開示を作成
  const disclosure: TDNetDisclosure = {
    companyCode: secCode,
    companyName,
    docTitle: `【テスト】${companyName} 決算短信`,
    docType: "決算短信",
    publishedAt: new Date(),
    docUrl: "",
    source: "edinet",
  };
  steps.disclosure = disclosure;

  // Step 3: EDINET enrichment（決算データ + 企業情報）
  let earnings = null;
  let company = null;

  try {
    earnings = await getEarnings(secCode);
    steps.getEarnings = earnings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getEarnings: ${msg}`);
  }

  try {
    company = await getCompany(secCode);
    steps.getCompanyDetail = company;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getCompany(detail): ${msg}`);
  }

  // Step 4: 中期経営計画 PDF 取得（非致命的）
  let midtermPdfs: { url: string; title: string }[] | undefined;
  try {
    const sections = await getIrSections(secCode, {
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
    steps.midtermPdfs = midtermPdfs ?? "none found";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`midtermPdfs: ${msg}`);
    steps.midtermPdfs = { error: msg };
  }

  // Step 5: 構造化サマリー生成（Claude API 不要）
  const summary = buildIrSummary(disclosure, earnings, company);
  steps.summary = summary;

  // Step 6: Discord通知 + Supabase保存（opt-in）
  if (shouldNotify) {
    try {
      await sendDiscordNotification({
        disclosure,
        summary,
        earnings: earnings ?? undefined,
        company: company ?? undefined,
        midtermPdfs,
      });
      steps.discordNotify = "sent";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`discord: ${msg}`);
      steps.discordNotify = { error: msg };
    }

    try {
      await supabase.from("notifications").insert({
        company_code: disclosure.companyCode,
        company_name: disclosure.companyName,
        doc_title: disclosure.docTitle,
        doc_type: disclosure.docType,
        doc_url: disclosure.docUrl,
        published_at: disclosure.publishedAt.toISOString(),
        summary: summary.lines.join("\n"),
      });
      steps.supabaseInsert = "inserted";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`supabase: ${msg}`);
      steps.supabaseInsert = { error: msg };
    }
  } else {
    steps.discordNotify = "skipped (notify=false)";
    steps.supabaseInsert = "skipped (notify=false)";
  }

  return NextResponse.json({
    testTarget: secCode,
    companyName,
    success: errors.length === 0,
    errors,
    steps,
  });
}
