// Financial Modeling Prep (FMP) /stable/ API レスポンス型定義

export interface FmpCompanyProfile {
  symbol: string;
  companyName: string;
  industry: string;
  sector: string;
  mktCap: number; // USD (marketCap)
  price: number;
  country: string;
  exchange: string;
  exchangeFullName: string;
  website: string;
  description: string;
  currency: string;
  ceo: string;
  cik: string; // SEC CIK番号（例: "0000320193"）
}

export interface FmpIncomeStatement {
  date: string; // fiscal period end (YYYY-MM-DD)
  symbol: string;
  reportedCurrency: string;
  filingDate: string; // 提出日（YYYY-MM-DD）— 新規決算検知に使用
  acceptedDate: string;
  fiscalYear: string;
  period: string; // "Q1" | "Q2" | "Q3" | "Q4" | "FY"
  revenue: number;
  operatingIncome: number;
  netIncome: number;
  eps: number;
  epsDiluted: number;
  ebitda: number;
  link?: string; // SEC filing URL
  finalLink?: string;
}
