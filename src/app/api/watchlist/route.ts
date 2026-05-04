/**
 * GET  /api/watchlist              → ウォッチリスト一覧を返す
 * POST /api/watchlist              → 銘柄を追加 { company_code, company_name, market? }
 * DELETE /api/watchlist?code=7203&market=jp → 銘柄を削除
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { Market } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("watchlists")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const code = body?.company_code?.trim();
  const name = body?.company_name?.trim() ?? "";
  const market: Market = body?.market === "overseas" ? "overseas" : "jp";

  if (!code) {
    return NextResponse.json({ error: "company_code は必須です" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("watchlists")
    .insert({ company_code: code, company_name: name, market })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "すでに登録済みです" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const market: Market = params.get("market") === "overseas" ? "overseas" : "jp";

  if (!code) {
    return NextResponse.json({ error: "code パラメータが必要です" }, { status: 400 });
  }

  const { error } = await supabase
    .from("watchlists")
    .delete()
    .eq("company_code", code)
    .eq("market", market);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: code, market });
}
