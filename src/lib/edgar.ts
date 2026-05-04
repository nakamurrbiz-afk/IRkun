/**
 * SEC EDGAR XBRL API クライアント
 *
 * Company Facts API で全米上場企業の財務データを無料・無制限に取得。
 * https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
 *
 * Rate limit: 10 req/sec（日次制限なし）
 * 認証不要。User-Agent ヘッダーにメールアドレスが必要（SEC ポリシー）。
 */

const EDGAR_BASE = "https://data.sec.gov/api/xbrl/companyfacts";
const USER_AGENT = "IRkun/1.0 nakamurr.biz@gmail.com";

// 収益を表す XBRL 概念名（優先順位順 — 企業ごとに異なる）
const REVENUE_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
  "SalesRevenueServicesNet",
];

const OPERATING_INCOME_CONCEPTS = [
  "OperatingIncomeLoss",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
];

const NET_INCOME_CONCEPTS = [
  "NetIncomeLoss",
  "NetIncomeLossAvailableToCommonStockholdersBasic",
  "ProfitLoss",
];

const EPS_CONCEPTS = [
  "EarningsPerShareDiluted",
  "EarningsPerShareBasicAndDiluted",
  "EarningsPerShareBasic",
];

export interface EdgarFinancials {
  cik: string;
  filedDate: string; // 最新 filing の提出日
  period: string; // "Q1 FY2025" 形式
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
}

interface XbrlFact {
  val: number;
  filed: string;
  form: string;
  fp: string; // "Q1", "Q2", "Q3", "FY"
  fy: number;
  start: string;
  end: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompanyFacts = Record<string, any>;

/**
 * SEC EDGAR から企業の最新四半期決算データを取得
 * @param cik SEC CIK 番号（ゼロパディングあり/なし両対応）
 */
export async function getEdgarFinancials(cik: string): Promise<EdgarFinancials | null> {
  const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");

  const res = await fetch(`${EDGAR_BASE}/CIK${paddedCik}.json`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    console.warn(`[edgar] CIK${paddedCik} failed: ${res.status}`);
    return null;
  }

  const data: CompanyFacts = await res.json();
  const usGaap = data?.facts?.["us-gaap"];
  if (!usGaap) return null;

  // 最新の四半期エントリを取得するヘルパー
  function getLatestQuarterly(concepts: string[]): XbrlFact | null {
    for (const concept of concepts) {
      const entries: XbrlFact[] | undefined = usGaap[concept]?.units?.["USD"]
        ?? usGaap[concept]?.units?.["USD/shares"];
      if (!entries || entries.length === 0) continue;

      // 単一四半期のエントリのみ抽出（期間が60〜100日）
      const quarterly = entries.filter((e) => {
        const days =
          (new Date(e.end).getTime() - new Date(e.start).getTime()) / 86400000;
        return days > 60 && days < 100;
      });

      if (quarterly.length > 0) {
        // filed 日が最新のものを返す
        return quarterly.reduce((a, b) =>
          a.filed > b.filed ? a : b,
        );
      }
    }
    return null;
  }

  // EPS は期間フィルタなしで最新を取る（per-share は期間関係ない場合もある）
  function getLatestEps(concepts: string[]): XbrlFact | null {
    for (const concept of concepts) {
      const entries: XbrlFact[] | undefined =
        usGaap[concept]?.units?.["USD/shares"];
      if (!entries || entries.length === 0) continue;

      const quarterly = entries.filter((e) => {
        const days =
          (new Date(e.end).getTime() - new Date(e.start).getTime()) / 86400000;
        return days > 60 && days < 100;
      });

      if (quarterly.length > 0) {
        return quarterly.reduce((a, b) => (a.filed > b.filed ? a : b));
      }
    }
    return null;
  }

  const revFact = getLatestQuarterly(REVENUE_CONCEPTS);
  const opFact = getLatestQuarterly(OPERATING_INCOME_CONCEPTS);
  const niFact = getLatestQuarterly(NET_INCOME_CONCEPTS);
  const epsFact = getLatestEps(EPS_CONCEPTS);

  // いずれかのデータが取れなければ null を返さず取れたものだけ返す
  const bestFact = revFact ?? opFact ?? niFact ?? epsFact;
  if (!bestFact) return null;

  return {
    cik: paddedCik,
    filedDate: bestFact.filed,
    period: `${bestFact.fp} FY${bestFact.fy}`,
    revenue: revFact?.val ?? null,
    operatingIncome: opFact?.val ?? null,
    netIncome: niFact?.val ?? null,
    epsDiluted: epsFact?.val ?? null,
  };
}
