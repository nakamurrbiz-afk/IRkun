/**
 * GET /api/test/edinet?code=8802
 *
 * EDINET DB MCP API の単体テスト用エンドポイント。
 * 証券コードを受け取り、各関数を順に呼び出して結果を返す。
 * 本番デプロイ前に削除すること。
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveEdinetCode,
  getEvents,
  getEarnings,
  getIrSections,
  getCompany,
} from "@/lib/edinet";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secCode = req.nextUrl.searchParams.get("code") ?? "8802";
  const steps: Record<string, unknown> = {};
  const errors: string[] = [];

  // Step 1: 証券コード → EDINETコード変換
  try {
    const edinetCode = await resolveEdinetCode(secCode);
    steps.resolveEdinetCode = { secCode, edinetCode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`resolveEdinetCode: ${msg}`);
    steps.resolveEdinetCode = { error: msg };
  }

  // Step 2: get_events（当日分）
  try {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);
    const events = await getEvents({
      secCode,
      since: yesterday,
      limit: 10,
    });
    steps.getEvents = { count: events.length, events };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getEvents: ${msg}`);
    steps.getEvents = { error: msg };
  }

  // Step 3: get_earnings
  try {
    const earnings = await getEarnings(secCode);
    steps.getEarnings = earnings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getEarnings: ${msg}`);
    steps.getEarnings = { error: msg };
  }

  // Step 4: get_ir_sections
  try {
    const sections = await getIrSections(secCode);
    steps.getIrSections = {
      count: sections.length,
      sections: sections.map((s) => ({
        sectionType: s.sectionType,
        title: s.title,
        contentLength: s.content.length,
        contentPreview: s.content.slice(0, 200),
        pdfType: s.pdfType,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getIrSections: ${msg}`);
    steps.getIrSections = { error: msg };
  }

  // Step 5: get_company
  try {
    const company = await getCompany(secCode);
    steps.getCompany = company;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getCompany: ${msg}`);
    steps.getCompany = { error: msg };
  }

  return NextResponse.json({
    testTarget: secCode,
    success: errors.length === 0,
    errors,
    steps,
  });
}
