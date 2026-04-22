/**
 * Supabase サーバーサイドクライアント
 *
 * service_role キーを使用するため、API Routes（サーバーサイド）専用。
 * クライアントコンポーネントから直接インポートしてはいけない。
 * ブラウザからは /api/* 経由でのみアクセスする。
 */

import { createClient } from "@supabase/supabase-js";

// ビルド時に throw しないよう、フォールバック値を設定。
// 未設定のまま API を呼ぶと Supabase 側でエラーになるため、
// Vercel の Environment Variables に必ず設定すること。
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder";

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ── 型定義 ────────────────────────────────────────────────

export interface WatchlistRow {
  id: string;
  company_code: string;
  company_name: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  company_code: string;
  company_name: string;
  doc_title: string;
  doc_type: string;
  doc_url: string;
  published_at: string;
  summary: string;
  notified_at: string;
}
