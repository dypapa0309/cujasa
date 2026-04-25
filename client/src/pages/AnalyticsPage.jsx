import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MetricCard from '../components/MetricCard.jsx';
import InsightCard from '../components/InsightCard.jsx';

export default function AnalyticsPage({ selectedAccount }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (selectedAccount) api.get(`/api/accounts/${selectedAccount.id}/analytics`).then(setData).catch(console.error);
  }, [selectedAccount?.id]);
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="계정 클릭" value={data?.accountClicks ?? 0} />
        <MetricCard label="주제별 클릭 항목" value={data?.topicClicks?.length ?? 0} />
        <MetricCard label="상품별 클릭 항목" value={Object.keys(data?.productClicks || {}).length} />
        <MetricCard label="CTA별 클릭 항목" value={Object.keys(data?.ctaClicks || {}).length} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(data?.recommendations || []).map((item) => <InsightCard key={item} title="다음 추천 주제" detail={item} />)}
      </div>
    </div>
  );
}
