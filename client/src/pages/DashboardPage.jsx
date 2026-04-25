import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MetricCard from '../components/MetricCard.jsx';
import InsightCard from '../components/InsightCard.jsx';

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  useEffect(() => { api.get('/api/analytics/dashboard/summary').then(setSummary).catch(console.error); }, []);
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="전체 계정 수" value={summary?.accounts ?? '-'} />
        <MetricCard label="오늘 예약 글" value={summary?.scheduledToday ?? '-'} />
        <MetricCard label="업로드 완료" value={summary?.posted ?? '-'} />
        <MetricCard label="클릭 수" value={summary?.clicks ?? '-'} />
      </div>
      <InsightCard title="성과 좋은 주제" detail="클릭 데이터가 쌓이면 계정별로 강한 주제와 상품 조합을 표시합니다." />
    </div>
  );
}
