import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';

export default function CustomerHomePage({ account }) {
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

  const isActive = account?.status === 'active';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const todayScheduled = queue.filter((r) => {
    const d = new Date(r.scheduled_at);
    return r.status === 'scheduled' && d >= today && d < tomorrow;
  });

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

      {/* 자동화 상태 카드 */}
      <div className={`rounded-2xl p-6 ${isActive ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'} text-white`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-gray-200'}`} />
          <span className="font-bold text-sm">{isActive ? '자동화 실행 중' : '일시 정지됨'}</span>
        </div>
        <div className="text-2xl font-black mb-1">{account?.name}</div>
        <div className="text-emerald-100 text-sm">{isActive ? '24시간 자동으로 포스팅하고 있습니다' : '관리자에게 문의해주세요'}</div>
      </div>

      {/* 오늘 통계 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl p-4 text-center border border-gray-100">
          <div className="text-2xl font-black text-coupang">{todayScheduled.length}</div>
          <div className="text-xs text-gray-400 mt-1">오늘 예약</div>
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

      {/* 오늘 예약 목록 */}
      {todayScheduled.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <div className="font-bold text-sm text-gray-700">오늘 예약된 포스팅</div>
          </div>
          <div className="divide-y divide-gray-50">
            {todayScheduled.map((r) => (
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
                {r.post_url && (
                  <a href={r.post_url} target="_blank" rel="noreferrer"
                    className="text-xs text-coupang font-medium hover:underline">
                    보기 →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {totalPosted === 0 && todayScheduled.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="text-3xl mb-3">🚀</div>
          <div className="font-bold text-gray-700 mb-1">곧 시작됩니다</div>
          <div className="text-sm text-gray-400">첫 포스팅이 올라가면 여기에 표시됩니다</div>
        </div>
      )}
    </div>
  );
}
