import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Beaker, FileText, Link2, PlayCircle, Settings } from 'lucide-react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';

function modeLabel(mode) {
  if (mode === 'link') return '링크 글';
  if (mode === 'no_link') return '일반 글';
  return '자동 판정';
}

function statusLabel(status) {
  return {
    scheduled: '예약',
    posted: '완료',
    failed: '실패',
    retry: '재시도',
    manual_required: '확인 필요',
    skipped: '제외'
  }[status] || status || '대기';
}

export default function CustomerBetaPage({ account, setTab }) {
  const [queue, setQueue] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const checks = [
    '주제와 타겟 상황이 먼저 자연스럽게 잡히는지 확인',
    '본문에 광고 문구나 링크 유도 문장이 섞이지 않는지 확인',
    '이모지는 0~1개만 쓰이고 문장이 과장되지 않는지 확인',
    '쿠팡 상품이 글의 맥락과 실제로 맞는지 확인',
    '링크 글에만 CTA/광고 고지/단축 링크가 붙는지 확인'
  ];

  useEffect(() => {
    if (!account?.id) return;
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.get(`/api/accounts/${account.id}/queue`),
      api.get(`/api/accounts/${account.id}/analytics`)
    ]).then(([queueRows, analyticsData]) => {
      setQueue(Array.isArray(queueRows) ? queueRows : []);
      setAnalytics(analyticsData || null);
    }).catch((err) => {
      console.error(err);
      setLoadError('베타 점검 데이터를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.');
    }).finally(() => setLoading(false));
  }, [account?.id]);

  const summary = useMemo(() => {
    const scheduled = queue.filter((row) => row.status === 'scheduled').length;
    const posted = queue.filter((row) => row.status === 'posted').length;
    const needsReview = queue.filter((row) => ['failed', 'retry', 'manual_required', 'skipped'].includes(row.status)).length;
    const linkPosts = queue.filter((row) => row.post_mode === 'link').length;
    const noLinkPosts = queue.filter((row) => row.post_mode === 'no_link').length;
    return { scheduled, posted, needsReview, linkPosts, noLinkPosts };
  }, [queue]);

  const recentQueue = [...queue]
    .sort((a, b) => new Date(b.updated_at || b.posted_at || b.scheduled_at || b.created_at || 0) - new Date(a.updated_at || a.posted_at || a.scheduled_at || a.created_at || 0))
    .slice(0, 5);

  const warningRows = queue
    .filter((row) => ['failed', 'retry', 'manual_required', 'skipped'].includes(row.status) || row.error_category)
    .slice(0, 4);

  const linkRatio = Math.round(Number(account?.link_post_ratio ?? 0.3) * 100);
  const automationRunning = account?.status === 'active' && account?.automation_status === 'running';

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-blue-100 bg-white p-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-coupang">
          <Beaker size={24} />
        </div>
        <h1 className="text-2xl font-black text-gray-900">베타 테스트 운영판</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-500">
          실제 고객 화면에 넣기 전, 주제 선정부터 문장, 상품 매칭, 링크 처리까지 한 계정에서 먼저 점검합니다.
        </p>
        {account && (
          <div className="mt-5 grid gap-2 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
            <div>현재 점검 계정: <span className="font-black text-gray-900">{account.name}</span></div>
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className={automationRunning ? 'text-emerald-600' : 'text-gray-500'}>
                {automationRunning ? '자동화 실행 중' : '자동화 중지됨'}
              </span>
              <span className="text-gray-300">·</span>
              <span>링크 비율 {linkRatio}%</span>
              {account.account_handle && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>{account.account_handle}</span>
                </>
              )}
            </div>
          </div>
        )}
        {loadError && (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
            {loadError}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ['예약', summary.scheduled],
          ['완료', summary.posted],
          ['확인 필요', summary.needsReview],
          ['총 클릭', analytics?.totalClicks ?? 0]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-xs font-bold text-gray-400">{label}</div>
            <div className="mt-2 text-2xl font-black text-gray-900">{loading ? '-' : value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl border border-gray-100 bg-white p-6">
          <div className="flex items-center gap-2 text-gray-900">
            <Link2 size={18} />
            <h2 className="text-lg font-black">링크 처리 점검</h2>
          </div>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-2xl bg-blue-50 px-4 py-3">
              <span className="font-bold text-blue-700">링크 글</span>
              <span className="font-black text-blue-700">{summary.linkPosts}개</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
              <span className="font-bold text-gray-600">일반 글</span>
              <span className="font-black text-gray-700">{summary.noLinkPosts}개</span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-100 bg-white p-6">
          <div className="flex items-center gap-2 text-gray-900">
            <AlertTriangle size={18} />
            <h2 className="text-lg font-black">최근 경고</h2>
          </div>
          <div className="mt-4 grid gap-2">
            {warningRows.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">현재 확인 필요한 기록이 없습니다.</div>
            ) : warningRows.map((row) => (
              <div key={row.id} className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <div className="font-black">{row.friendly_title || statusLabel(row.status)}</div>
                <div className="mt-1 text-xs leading-relaxed">{row.friendly_message || row.error_message || row.error_category || '확인이 필요합니다.'}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-gray-100 bg-white p-6">
        <h2 className="text-lg font-black text-gray-900">검증할 흐름</h2>
        <div className="mt-4 grid gap-3 text-sm text-gray-600">
          {['주제 선정', '콘텐츠 문장', '상품 맥락', '링크/CTA', '업로드 결과'].map((label, index) => (
            <div key={label} className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-black text-coupang">
                {index + 1}
              </span>
              <span className="font-bold">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-gray-100 bg-white p-6">
        <div className="flex items-center gap-2 text-gray-900">
          <BarChart3 size={18} />
          <h2 className="text-lg font-black">최근 예약/업로드</h2>
        </div>
        <div className="mt-4 grid gap-2">
          {recentQueue.length === 0 ? (
            <div className="rounded-2xl bg-gray-50 px-4 py-5 text-center text-sm font-bold text-gray-400">아직 점검할 예약 기록이 없습니다.</div>
          ) : recentQueue.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-black text-gray-800">{statusLabel(row.status)} · {modeLabel(row.post_mode)}</div>
                <div className="mt-1 truncate text-xs text-gray-400">{dateTime(row.posted_at || row.scheduled_at || row.created_at)}</div>
              </div>
              {row.error_category && <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-600">{row.error_category}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-gray-100 bg-white p-6">
        <h2 className="text-lg font-black text-gray-900">콘텐츠 품질 기준</h2>
        <div className="mt-4 grid gap-3">
          {checks.map((check) => (
            <div key={check} className="rounded-2xl bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-600">
              {check}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <button type="button" onClick={() => setTab?.('settings')} className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-4 text-sm font-black text-gray-700">
          <Settings size={18} />
          설정 확인
        </button>
        <button type="button" onClick={() => setTab?.('run')} className="flex items-center justify-center gap-2 rounded-2xl bg-coupang px-4 py-4 text-sm font-black text-white">
          <PlayCircle size={18} />
          실행 점검
        </button>
        <button type="button" onClick={() => setTab?.('posts')} className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-4 text-sm font-black text-gray-700">
          <FileText size={18} />
          결과 보기
        </button>
      </section>
    </div>
  );
}
