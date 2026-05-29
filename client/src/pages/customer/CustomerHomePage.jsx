import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import TrialStatusCard from './TrialStatusCard.jsx';

function isTrustedThreadsPostUrl(url = '') {
  const value = String(url || '').trim();
  if (!value) return false;
  if (/\/mock\/threads\/[^/?#]+/i.test(value)) return true;
  if (!/https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[^/]+\/post\/[^/?#]+/i.test(value)) return false;
  return !/\/post\/\d+(?:[/?#].*)?$/i.test(value);
}

export default function CustomerHomePage({ account, currentUser, trialStatus, setTab }) {
  const [queue, setQueue] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!account) return;
    Promise.all([
      api.get(`/api/accounts/${account.id}/queue`),
      api.get(`/api/accounts/${account.id}/analytics`),
    ]).then(([q, a]) => {
      setQueue(q);
      setAnalytics(a);
    }).catch(console.error).finally(() => setLoading(false));
  }, [account?.id]);

  const isExpired = currentUser?.billing?.status === 'past_due';
  const isActive = account?.status === 'active' && !isExpired;
  const automationRunning = isActive && account?.automation_status === 'running';
  const statusLabel = isExpired
    ? '이용 기간 만료'
    : !isActive
      ? '일시 정지됨'
      : automationRunning
        ? '자동화 실행 중'
        : '자동화 중지됨';
  const statusMessage = isExpired
    ? '결제 탭에서 월결제를 연장하거나 1년 이용권으로 전환해주세요'
    : !isActive
      ? '계정 상태를 확인해주세요'
      : automationRunning
        ? '설정한 스케줄에 따라 매일 예약을 생성합니다'
        : '자동화 실행 탭에서 시작하면 매일 예약이 생성됩니다';

  const upcomingScheduled = queue
    .filter((r) => r.status === 'scheduled' && new Date(r.scheduled_at) >= new Date())
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 5);

  const recentPosted = queue
    .filter((r) => r.status === 'posted' && r.posted_at)
    .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))
    .slice(0, 5);

  const totalPosted = queue.filter((r) => r.status === 'posted').length;
  const totalClicks = analytics?.totalClicks ?? 0;

  if (loading) return (
    <div className="grid gap-4">
      {[...Array(3)].map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white border border-gray-100" />)}
    </div>
  );

  return (
    <div className="grid gap-5">
      <TrialStatusCard trialStatus={trialStatus} onUpgrade={() => setTab?.('billing')} />

      {/* 자동화 상태 카드 */}
      <div className={`rounded-2xl p-6 ${automationRunning ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'} text-white`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-3 h-3 rounded-full ${automationRunning ? 'bg-white animate-pulse' : 'bg-gray-200'}`} />
          <span className="font-bold text-sm">{statusLabel}</span>
        </div>
        <div className="text-2xl font-black mb-1">{account?.name}</div>
        <div className="text-sm text-white/80">
          {statusMessage}
        </div>
      </div>

      {/* 오늘 통계 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl p-4 text-center border border-gray-100">
          <div className="text-2xl font-black text-coupang">{upcomingScheduled.length}</div>
          <div className="text-xs text-gray-400 mt-1">예약 대기</div>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center border border-gray-100">
          <div className="text-2xl font-black text-gray-800">{totalPosted}</div>
          <div className="text-xs text-gray-400 mt-1">총 포스팅</div>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center border border-gray-100">
          <div className="text-2xl font-black text-blue-500">{totalClicks}</div>
          <div className="text-xs text-gray-400 mt-1">총 클릭</div>
        </div>
      </div>

      {/* 예약 목록 */}
      {upcomingScheduled.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <div className="font-bold text-sm text-gray-700">다가오는 예약 포스팅</div>
          </div>
          <div className="divide-y divide-gray-50">
            {upcomingScheduled.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-center justify-between">
                <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                <div className="text-sm text-gray-600 flex-1 mx-3">{dateTime(r.scheduled_at)}</div>
                <div className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">예약</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 최근 포스팅 */}
      {recentPosted.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <div className="font-bold text-sm text-gray-700">최근 포스팅</div>
          </div>
          <div className="divide-y divide-gray-50">
            {recentPosted.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-center justify-between">
                <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <div className="text-sm text-gray-500 flex-1 mx-3">{dateTime(r.posted_at)}</div>
                {r.post_url && isTrustedThreadsPostUrl(r.post_url) && (
                  <a href={r.post_url} target="_blank" rel="noreferrer"
                    className="text-xs text-coupang font-medium hover:underline">
                    보기 →
                  </a>
                )}
                {r.post_url && !isTrustedThreadsPostUrl(r.post_url) && (
                  <span className="text-xs font-bold text-amber-600">링크 확인 필요</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {totalPosted === 0 && upcomingScheduled.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="flex justify-center mb-3">
            <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>
            </svg>
          </div>
          <div className="font-bold text-gray-700 mb-1">곧 시작됩니다</div>
          <div className="text-sm text-gray-400">첫 포스팅이 올라가면 여기에 표시됩니다</div>
        </div>
      )}
    </div>
  );
}
