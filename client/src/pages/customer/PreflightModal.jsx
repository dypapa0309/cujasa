export default function PreflightModal({ result, onClose, onReconnect }) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const blocking = checks.filter((check) => check.status === 'error');
  const warnings = checks.filter((check) => check.status === 'warn');
  const passed = checks.filter((check) => check.status === 'ok');
  const needsReconnect = checks.some((check) => check.action === 'reconnect_threads');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 border-b border-gray-100 px-6 py-5">
          <div className="text-lg font-black text-gray-900">사전 점검 결과</div>
          <div className={`mt-1 text-sm font-semibold ${result?.canPublish ? 'text-emerald-600' : 'text-rose-600'}`}>
            {result?.canPublish ? '현재 설정 점검 통과' : '자동화 전에 조치가 필요합니다'}
          </div>
        </div>
        <div className="grid gap-4 overflow-y-auto px-6 py-5">
          {blocking.length > 0 && <CheckGroup title="현재 실행 차단" tone="error" checks={blocking} />}
          {warnings.length > 0 && <CheckGroup title="주의/과거 기록" tone="warn" checks={warnings} />}
          {passed.length > 0 && <CheckGroup title="정상" tone="ok" checks={passed} />}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-500">
            닫기
          </button>
          {needsReconnect && (
            <button type="button" onClick={onReconnect} className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-bold text-white">
              다시 연결하기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckGroup({ title, tone, checks }) {
  const styles = {
    error: 'border-rose-100 bg-rose-50 text-rose-700',
    warn: 'border-amber-100 bg-amber-50 text-amber-700',
    ok: 'border-emerald-100 bg-emerald-50 text-emerald-700'
  };
  return (
    <div>
      <div className="mb-2 text-xs font-black uppercase tracking-widest text-gray-400">{title}</div>
      <div className="grid gap-2">
        {checks.map((check) => (
          <div key={`${check.key}-${check.title}`} className={`rounded-xl border px-4 py-3 ${styles[tone]}`}>
            <div className="text-sm font-black">{check.title}</div>
            <div className="mt-1 break-words text-xs leading-relaxed opacity-80">{check.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
