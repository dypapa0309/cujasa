import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MetricCard from '../components/MetricCard.jsx';

export default function AnalyticsPage({ selectedAccount }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedAccount) return;
    setLoading(true);
    api.get(`/api/accounts/${selectedAccount.id}/analytics`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedAccount?.id]);

  const totalClicks = data?.accountClicks ?? 0;
  const topicClicks = data?.topicClicks ?? [];

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="총 클릭 수" value={totalClicks} />
        <MetricCard label="성과 있는 주제" value={topicClicks.length} />
        <MetricCard label="CTA 변형 수" value={Object.keys(data?.ctaClicks || {}).length} />
      </div>

      {loading && (
        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded border border-line bg-white" />)}
        </div>
      )}

      {!loading && topicClicks.length > 0 && (
        <div className="rounded border border-line bg-white p-5">
          <h3 className="mb-4 font-semibold">주제별 클릭 수</h3>
          <div className="grid gap-3">
            {topicClicks.map((item, i) => {
              const max = topicClicks[0]?.clicks || 1;
              const pct = Math.round((item.clicks / max) * 100);
              return (
                <div key={i} className="grid gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 truncate mr-3">{item.topic}</span>
                    <span className="font-semibold text-coupang flex-shrink-0">{item.clicks}클릭</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100">
                    <div className="h-1.5 rounded-full bg-coupang transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && topicClicks.length === 0 && (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">
          클릭 데이터가 쌓이면 주제별 성과가 표시됩니다
        </div>
      )}

      {!loading && (data?.recommendations || []).length > 0 && (
        <div className="rounded border border-line bg-white p-5">
          <h3 className="mb-3 font-semibold">다음 추천 방향</h3>
          <ul className="grid gap-2">
            {data.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="text-coupang font-bold flex-shrink-0">→</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
