/**
 * GET /api/test/fmp?symbol=AAPL&notify=false
 *
 * Overseas パイプラインテスト:
 *   FMP Profile → SEC EDGAR 決算 → 構造化サマリー → (Discord通知)
 *
 * パラメータ:
 *   symbol  — ティッカーシンボル（デフォルト: AAPL）
 *   notify  — "true" で Discord通知を実行（デフォルト: false）
 */

import { NextRequest, NextResponse } from "next/server";
import { getProfile, getRequestStats } from "@/lib/fmp";
import { getEdgarFinancials } from "@/lib/edgar";
import { buildOverseasSummary } from "@/lib/summary";
import { sendDiscordNotification } from "@/lib/discord";
import type { TDNetDisclosure } from "@/types";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "AAPL").toUpperCase();
  const shouldNotify = req.nextUrl.searchParams.get("notify") === "true";

  const steps: Record<string, unknown> = {};
  const errors: string[] = [];

  // Step 1: FMP 企業プロフィール取得（CIK を含む）
  let profile = null;
  try {
    profile = await getProfile(symbol);
    steps.getProfile = profile
      ? { symbol: profile.symbol, companyName: profile.companyName, cik: profile.cik, sector: profile.sector, mktCap: profile.mktCap, country: profile.country }
      : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getProfile: ${msg}`);
  }

  // Step 2: SEC EDGAR で決算データ取得
  let edgar = null;
  if (profile?.cik) {
    try {
      edgar = await getEdgarFinancials(profile.cik);
      steps.getEdgarFinancials = edgar;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`getEdgarFinancials: ${msg}`);
    }
  } else {
    steps.getEdgarFinancials = "skipped (no CIK from profile)";
  }

  // Step 3: 擬似開示を作成
  const disclosure: TDNetDisclosure = {
    companyCode: symbol,
    companyName: profile?.companyName ?? symbol,
    docTitle: `Earnings: ${symbol} ${edgar?.period ?? "(latest)"}`,
    docType: "Earnings Release",
    publishedAt: edgar?.filedDate ? new Date(edgar.filedDate) : new Date(),
    docUrl: "",
    source: "fmp",
    market: "overseas",
  };
  steps.disclosure = disclosure;

  // Step 4: 構造化サマリー生成
  const summary = buildOverseasSummary(disclosure, edgar, profile);
  steps.summary = summary;

  // Step 5: Discord通知（opt-in）
  if (shouldNotify) {
    try {
      await sendDiscordNotification({
        disclosure,
        summary,
        overseasProfile: profile ?? undefined,
        edgarFinancials: edgar ?? undefined,
      });
      steps.discordNotify = "sent";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`discord: ${msg}`);
      steps.discordNotify = { error: msg };
    }
  } else {
    steps.discordNotify = "skipped (notify=false)";
  }

  steps.fmpRequestStats = getRequestStats();

  return NextResponse.json({
    testTarget: symbol,
    companyName: profile?.companyName ?? symbol,
    success: errors.length === 0,
    errors,
    steps,
  });
}
