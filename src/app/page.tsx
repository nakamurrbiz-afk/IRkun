"use client";

import { useEffect, useState, useCallback } from "react";

interface WatchlistItem {
  id: string;
  company_code: string;
  company_name: string;
  created_at: string;
}

interface NotificationItem {
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

export default function Home() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [wRes, nRes] = await Promise.all([
      fetch("/api/watchlist"),
      fetch("/api/notifications"),
    ]);
    if (wRes.ok) setWatchlist(await wRes.json());
    if (nRes.ok) setNotifications(await nRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setAdding(true);
    setError("");
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_code: code.trim(),
        company_name: name.trim(),
      }),
    });
    if (res.ok) {
      setCode("");
      setName("");
      await fetchData();
    } else {
      const body = await res.json();
      setError(body.error ?? "追加に失敗しました");
    }
    setAdding(false);
  }

  async function deleteCompany(companyCode: string) {
    await fetch(`/api/watchlist?code=${companyCode}`, { method: "DELETE" });
    await fetchData();
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📊</span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">IR Alert</h1>
              <p className="text-xs text-gray-500">TDNet 適時開示 → Discord通知</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            稼働中
          </div>
        </div>

        {/* ウォッチリスト管理 */}
        <section className="bg-gray-900 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 tracking-wide uppercase">
            ウォッチリスト
          </h2>

          {/* 追加フォーム */}
          <form onSubmit={addCompany} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="証券コード（例: 7203）"
              maxLength={5}
              className="w-36 bg-gray-800 rounded-lg px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="企業名（任意）"
              className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={adding || !code.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
            >
              {adding ? "…" : "追加"}
            </button>
          </form>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* 一覧 */}
          {loading ? (
            <p className="text-xs text-gray-600 py-2">読み込み中…</p>
          ) : watchlist.length === 0 ? (
            <p className="text-xs text-gray-600 py-2">
              まだ銘柄が登録されていません。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {watchlist.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-blue-400 w-12">
                      {item.company_code}
                    </span>
                    <span className="text-sm text-gray-200">
                      {item.company_name || "—"}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteCompany(item.company_code)}
                    className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* IR通知履歴 */}
        <section className="bg-gray-900 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 tracking-wide uppercase">
            最近のIRアラート
          </h2>

          {loading ? (
            <p className="text-xs text-gray-600 py-2">読み込み中…</p>
          ) : notifications.length === 0 ? (
            <p className="text-xs text-gray-600 py-2">
              まだ通知履歴がありません。ウォッチリストの銘柄からIRが公開されると、ここに表示されます。
            </p>
          ) : (
            <ul className="space-y-3">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="border border-gray-800 rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-mono text-blue-400 mr-2">
                        {n.company_code}
                      </span>
                      <span className="text-sm font-medium text-white">
                        {n.company_name}
                      </span>
                    </div>
                    <span className="text-xs text-gray-600 whitespace-nowrap">
                      {formatDate(n.published_at)}
                    </span>
                  </div>

                  <p className="text-xs text-gray-400">{n.doc_title}</p>

                  {n.summary && (
                    <div className="bg-gray-800 rounded-lg px-3 py-2 space-y-0.5">
                      {n.summary.split("\n").map((line, i) => (
                        <p key={i} className="text-xs text-gray-300 leading-relaxed">
                          • {line}
                        </p>
                      ))}
                    </div>
                  )}

                  {n.doc_url && (
                    <a
                      href={n.doc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs text-blue-500 hover:text-blue-400 transition-colors"
                    >
                      原文を開く →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-xs text-gray-700 pb-4">
          ⚠️ AIサマリーは参考情報です。投資推奨ではありません。
        </p>
      </div>
    </main>
  );
}
