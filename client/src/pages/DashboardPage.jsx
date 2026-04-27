import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import MetricCard from '../components/MetricCard.jsx';

export default function DashboardPage() {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.get('/api/analytics/dashboard/summary')
      .then(setSummary)
      .catch(() => toast('대시보드 데이터를 불러오지 못했습니다.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const runPipeline = async () => {
    setRunning(true);
    try {
      const result = await api.post('/api/scheduler/run-pipeline', {});
      const ok = result.results?.filter((r) => r.status === 'ok').length ?? 0;
      const total = result.results?.length ?? 0;
      toast(`파이프라인 완료 (${ok}/${total} 계정 성공)`, ok === total ? 'success' : 'info');
      const updated = await api.get('/api/analytics/dashboard/summary');
      setSummary(updated);
    } catch {
      toast('파이프라인 실행에 실패했습니다.', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">전체 운영 현황</div>
        <button
          onClick={runPipeline}
          disabled={running}
          className="flex items-center gap-2 rounded bg-coupang px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running
            ? <><Spinner /> 실행 중...</>
            : '파이프라인 수동 실행'}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded border border-line bg-white" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="전체 계정 수" value={summary?.accounts ?? '-'} />
          <MetricCard label="오늘 예약 글" value={summary?.scheduledToday ?? '-'} />
          <MetricCard label="업로드 완료" value={summary?.posted ?? '-'} />
          <MetricCard label="클릭 수" value={summary?.clicks ?? '-'} />
        </div>
      )}

      {running && (
        <div className="flex items-center gap-3 rounded-lg border border-coupang/20 bg-red-50 px-4 py-3 text-sm font-medium text-coupang">
          <Spinner />
          주제 생성 → 상품 검색 → 콘텐츠 생성 → 큐 등록 순으로 실행 중입니다. 1~2분 소요됩니다.
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
