export default function TrialStatusCard({ trialStatus, onUpgrade }) {
  if (!trialStatus) return null;

  if (trialStatus.plan === 'free') {
    return null;
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
