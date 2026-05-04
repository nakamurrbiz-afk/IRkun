-- 海外企業対応: market カラム追加
-- 既存データは全て 'jp' として扱う（DEFAULT 'jp'）

-- watchlists テーブル
ALTER TABLE watchlists ADD COLUMN market TEXT NOT NULL DEFAULT 'jp';
ALTER TABLE watchlists DROP CONSTRAINT IF EXISTS watchlists_company_code_key;
ALTER TABLE watchlists ADD CONSTRAINT watchlists_code_market_unique UNIQUE (company_code, market);

-- notifications テーブル
ALTER TABLE notifications ADD COLUMN market TEXT NOT NULL DEFAULT 'jp';
CREATE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications (company_code, market, doc_title, published_at);
