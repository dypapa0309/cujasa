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
  const signals = data?.learningSignals || {};
  const topProducts = signals.topProducts || [];
  const topPosts = signals.topPosts || [];
  const topFormats = signals.topContentFormats || [];
  const topGoals = signals.topContentGoals || [];

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

      {!loading && topProducts.length > 0 && (
        <div className="rounded border border-line bg-white p-5">
          <h3 className="mb-4 font-semibold">상품별 클릭 수</h3>
          <div className="grid gap-2">
            {topProducts.slice(0, 10).map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm rounded bg-gray-50 px-3 py-2">
                <div className="min-w-0 truncate text-slate-700">
                  <span className="font-medium">{p.productName || p.keyword || '상품'}</span>
                  {p.category && <span className="ml-2 text-xs text-slate-400">{p.category}</span>}
                </div>
                <span className="font-semibold text-coupang flex-shrink-0 ml-3">{p.clicks}클릭</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && topPosts.length > 0 && (
        <div className="rounded border border-line bg-white p-5">
          <h3 className="mb-4 font-semibold">성과 높은 글</h3>
          <div className="grid gap-2">
            {topPosts.slice(0, 5).map((p, i) => (
              <div key={i} className="rounded bg-gray-50 px-3 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600 truncate mr-3">{p.topicTitle || '주제 없음'}</span>
                  <span className="font-semibold text-coupang text-sm flex-shrink-0">{p.clicks}클릭</span>
                </div>
                <div className="text-xs text-slate-500 truncate">{p.bodySnippet}</div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {p.contentFormat && <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{p.contentFormat}</span>}
                  {p.contentGoal && <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{p.contentGoal}</span>}
                  {p.lengthBucket && <span className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{p.lengthBucket}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && (topFormats.length > 0 || topGoals.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {topFormats.length > 0 && (
            <div className="rounded border border-line bg-white p-5">
              <h3 className="mb-3 font-semibold text-sm">콘텐츠 포맷별 성과</h3>
              <div className="grid gap-1.5">
                {topFormats.slice(0, 6).map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{f.format || f.contentFormat || '기타'}</span>
                    <span className="font-semibold text-coupang">{f.clicks}클릭</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {topGoals.length > 0 && (
            <div className="rounded border border-line bg-white p-5">
              <h3 className="mb-3 font-semibold text-sm">콘텐츠 목표별 성과</h3>
              <div className="grid gap-1.5">
                {topGoals.slice(0, 6).map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{g.goal || g.contentGoal || '기타'}</span>
                    <span className="font-semibold text-coupang">{g.clicks}클릭</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && topicClicks.length === 0 && topProducts.length === 0 && (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">
          클릭 데이터가 쌓이면 주제별/상품별 성과가 표시됩니다
        </div>
      )}

      {!loading && (data?.recommendations || []).length > 0 && (
        <div className="rounded border border-line bg-white p-5">
          <h3 className="mb-3 font-semibold">다음 생성에 반영되는 성과 힌트</h3>
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
