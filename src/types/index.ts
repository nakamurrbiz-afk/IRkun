// TDNet（東証適時開示）からの開示情報
export interface TDNetDisclosure {
  companyCode: string;       // 証券コード（例: "7203"）またはティッカー（例: "AAPL"）
  companyName: string;       // 会社名（例: "トヨタ自動車株式会社"）
  docTitle: string;          // 開示タイトル
  docType: string;           // 種別（例: "決算短信", "適時開示"）
  publishedAt: Date;         // 公開日時
  docUrl: string;            // 原文URL（TDNet viewer）
  xbrlUrl?: string;          // XBRLデータURL（あれば）
  source?: "tdnet" | "edinet" | "fmp"; // データソース
  market?: "jp" | "overseas"; // マーケット区分
}

// EDINET DB から取得した決算短信データ
export interface EdinetEarnings {
  companyCode: string;
  companyName: string;
  fiscalYear: string;        // 例: "2026年3月期"
  revenue?: number;          // 売上高（百万円）
  revenueYoy?: number;       // 売上高前年比（%）
  operatingProfit?: number;  // 営業利益（百万円）
  operatingProfitYoy?: number;
  netProfit?: number;        // 当期純利益（百万円）
  eps?: number;              // 1株当たり利益
  forecast?: string;         // 来期予想サマリー（テキスト）
  pdfUrl?: string;           // 決算短信PDFのURL
}

// EDINET DB から取得した企業基本情報
export interface EdinetCompany {
  companyCode: string;
  companyName: string;
  industry: string;          // 業種
  marketCap?: number;        // 時価総額
  healthScore?: number;      // 財務健全性スコア（0-100）
  roe?: number;              // 自己資本利益率（%）
  per?: number;              // 株価収益率
  dividendYield?: number;    // 配当利回り（%）
  textBlocksUrl?: string;    // EDINET DB テキストブロックURL
}

// EDINET DB イベント（get_events レスポンス）
export interface EdinetEvent {
  secCode: string;             // 証券コード（例: "7203"）
  edinetCode: string;          // EDINETコード（例: "E02144"）
  companyName: string;
  eventType: string;           // イベント種別（例: "earnings_summary"）
  eventCategory: string;       // カテゴリ（例: "earnings"）
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  publishedAt: string;         // ISO日付
  source: string;
}

// EDINET DB IR セクション（get_ir_sections_by_company レスポンス）
export interface IrSection {
  sectionType: string;         // セクション種別（例: "strategy"）
  title: string;
  content: string;
  pdfType?: string;            // PDF種別（例: "midterm"）
  pdfUrl?: string;             // PDF URL
  pdfTitle?: string;           // PDF タイトル
  publishedAt?: string;
}

// EDINET データから構造化した開示サマリー（Claude不要）
export interface IrSummary {
  lines: string[];           // 構造化テキスト行（Supabase保存・表示用）
  sentiment: "positive" | "negative" | "neutral";
  earnings?: EdinetEarnings;
  company?: EdinetCompany;
}

// Discord通知ペイロード
export interface DiscordNotification {
  disclosure: TDNetDisclosure;
  summary: IrSummary;
  earnings?: EdinetEarnings;
  company?: EdinetCompany;
  midtermPdfs?: { url: string; title: string }[];
  // Overseas（FMP + SEC EDGAR）
  overseasProfile?: import("@/types/overseas").FmpCompanyProfile;
  edgarFinancials?: import("@/lib/edgar").EdgarFinancials;
}

// ポーリング結果レポート
export interface PollResult {
  checkedAt: Date;
  totalDisclosures: number;    // TDNetから取得した開示数
  matchedCount: number;        // ウォッチリストにマッチした数
  notifiedCount: number;       // 実際に通知した数
  errors: string[];            // エラーメッセージ
}
