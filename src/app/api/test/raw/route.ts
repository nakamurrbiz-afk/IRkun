/**
 * GET /api/test/raw?tool=get_company&code=8802
 *
 * EDINET DB MCP の生レスポンスを確認するデバッグ用エンドポイント。
 * フィールド名の特定に使う。本番デプロイ前に削除すること。
 */

import { NextRequest, NextResponse } from "next/server";

const EDINET_MCP_URL = "https://edinetdb.jp/mcp";
let requestId = 100;

async function initSession(): Promise<string | null> {
  const res = await fetch(EDINET_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "ir-alert-debug", version: "1.0" },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.headers.get("Mcp-Session-Id");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tool = req.nextUrl.searchParams.get("tool") ?? "get_company";
  const code = req.nextUrl.searchParams.get("code") ?? "8802";
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const sessionId = await initSession();

  // ツールごとの引数を構築
  let args: Record<string, unknown> = {};
  switch (tool) {
    case "get_company":
      args = { edinet_code: code };
      break;
    case "get_earnings":
      args = { edinet_code: code };
      break;
    case "get_ir_sections_by_company":
      args = { edinet_code: code, latest_n: 1 };
      break;
    case "search_companies":
      args = { query: code, limit: 3 };
      break;
    case "get_events":
      args = { sec_code: code, since: "2025-01-01", limit: 5 };
      break;
    default:
      args = { edinet_code: code };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(EDINET_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId++,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    cache: "no-store",
  });

  const json = await res.json();

  // result.content[0].text の生テキストを取得
  const rawText = json.result?.content?.[0]?.text ?? null;
  let parsed = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }

  return NextResponse.json({
    tool,
    args,
    status: res.status,
    rawText: rawText ? rawText.slice(0, 3000) : null,
    parsed,
    jsonRpcError: json.error ?? null,
  });
}
