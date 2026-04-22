// TDNet（東証適時開示）からの開示情報
export interface TDNetDisclosure {
  companyCode: string;       // 証券コード（例: "7203"）
  companyName: string;       // 会社名（例: "トヨタ自動車株式会社"）
  docTitle: string;          // 開示タイトル
  docType: string;           // 種別（例: "決算短信", "適時開示"）
  publishedAt: Date;         // 公開日時
  docUrl: string;            // 原文URL（TDNet viewer）
  xbrlUrl?: string;          // XBRLデータURL（あれば）
}

// EDINET DB から取得した決算短信データ
export interface EdinetEarnings {
  companyCode: string;
  companyName: string;
  fiscalYear: string;        // 例: "2026年3月期"
  revenue?: number;          // 売上高（円）
  revenueYoy?: number;       // 売上高前年比（%）
  operatingProfit?: number;  // 営業利益（円）
  operatingProfitYoy?: number;
  netProfit?: number;        // 当期純利益（円）
  eps?: number;              // 1株当たり利益
  forecast?: string;         // 来期予想サマリー（テキスト）
}

// EDINET DB から取得した企業基本情報
export interface EdinetCompany {
  companyCode: string;
  companyName: string;
  industry: string;          // 業種
  marketCap?: number;        // 時価総額
  healthScore?: number;      // 財務健全性スコア（0-100）
}

// Claude API が生成した要約
export interface IrSummary {
  lines: [string, string, string]; // 必ず3行
  sentiment: "positive" | "negative" | "neutral"; // 全体トーン
}

// Discord通知ペイロード
export interface DiscordNotification {
  disclosure: TDNetDisclosure;
  summary: IrSummary;
  earnings?: EdinetEarnings;  // 決算系の場合のみ
}

// ポーリング結果レポート
export interface PollResult {
  checkedAt: Date;
  totalDisclosures: number;    // TDNetから取得した開示数
  matchedCount: number;        // ウォッチリストにマッチした数
  notifiedCount: number;       // 実際に通知した数
  errors: string[];            // エラーメッセージ
}
