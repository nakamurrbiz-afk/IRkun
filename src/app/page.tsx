/**
 * ステータスページ（Day 1-3 プロトタイプ用）
 * Day 4-7 でウォッチリスト管理UIに差し替える。
 */
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white p-8">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="text-5xl">📊</div>
        <h1 className="text-2xl font-bold tracking-tight">IR Alert</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          ウォッチリスト銘柄の適時開示を検知し、
          <br />
          AI要約をDiscordにリアルタイム通知します。
        </p>

        <div className="bg-gray-900 rounded-xl p-5 text-left space-y-3 text-sm">
          <div className="flex items-center gap-2 text-green-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            稼働中
          </div>
          <div className="text-gray-400 space-y-1">
            <p>• ポーリング間隔: 30分（平日 7:30〜18:00）</p>
            <p>• データソース: TDNet（東証適時開示）</p>
            <p>• 通知先: Discord Webhook</p>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          ⚠️ AIサマリーは参考情報です。投資推奨ではありません。
        </p>
      </div>
    </main>
  );
}
