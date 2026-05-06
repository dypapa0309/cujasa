export default function TrialStatusCard({ trialStatus, onUpgrade }) {
  if (!trialStatus) return null;

  if (trialStatus.plan === 'free') {
    return (
      <div className={`rounded-2xl border px-5 py-4 ${trialStatus.blocked ? 'border-rose-200 bg-rose-50' : 'border-blue-100 bg-blue-50'}`}>
        <div className={`text-sm font-black ${trialStatus.blocked ? 'text-rose-700' : 'text-blue-700'}`}>
          {trialStatus.blocked ? '무료 체험 종료' : `무료 체험: ${trialStatus.limit}회 중 ${trialStatus.used}회 사용`}
        </div>
        <div className={`mt-1 text-xs ${trialStatus.blocked ? 'text-rose-600' : 'text-blue-600'}`}>
          {trialStatus.blocked ? '무료 체험 포스팅 5회를 모두 사용했습니다.' : `남은 무료 포스팅: ${trialStatus.remaining}회`}
        </div>
        {trialStatus.blocked && (
          <div className="mt-4 grid gap-2">
            <p className="text-sm leading-relaxed text-rose-700">
              쿠자사의 자동 포스팅 흐름을 확인하셨다면, 이제 실제 계정 운영을 시작해보세요.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onUpgrade} className="flex-1 rounded-xl bg-coupang px-4 py-3 text-sm font-bold text-white">
                정식 버전 결제하기
              </button>
              <a href="sms:01040941666?body=%5BCUJASA%20%EC%83%81%EB%8B%B4%5D%20" className="flex-1 rounded-xl border border-rose-200 bg-white px-4 py-3 text-center text-sm font-bold text-rose-600">
                상담 문의하기
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (trialStatus.plan === 'paid') {
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4">
        <div className="text-sm font-black text-emerald-700">정식 이용 중</div>
        <div className="mt-1 text-xs text-emerald-600">
          {trialStatus.paidPlan === 'monthly' && trialStatus.paidUntil
            ? `${new Date(trialStatus.paidUntil).toLocaleDateString('ko-KR')}까지 이용 가능 · 포스팅 제한 없음`
            : '포스팅 제한 없음'}
        </div>
      </div>
    );
  }

  if (trialStatus.plan === 'admin') {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white px-5 py-4">
        <div className="text-sm font-black text-slate-700">관리자 계정</div>
        <div className="mt-1 text-xs text-slate-500">제한 없음</div>
      </div>
    );
  }

  return null;
}
