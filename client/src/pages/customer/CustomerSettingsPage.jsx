import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';
import SensitiveInput from '../../components/SensitiveInput.jsx';
import TrialStatusCard from './TrialStatusCard.jsx';

export default function CustomerSettingsPage({ account, reloadAccounts, onPipelineDone, onPipelineRunningChange, trialStatus, reloadTrialStatus, reloadSetupStatus, setTab }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [connectingThreads, setConnectingThreads] = useState(false);
  const [confirmingThreads, setConfirmingThreads] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!account) {
      setForm(null);
      return;
    }
    setForm({
      name: account.name || '',
      account_handle: account.account_handle || '',
      target_audience: account.target_audience || '',
      content_scope: account.content_scope || '',
      tone: account.tone || '',
      cta_style: account.cta_style || '',
      forbidden_topics: Array.isArray(account.forbidden_topics) ? account.forbidden_topics.join('\n') : '',
      forbidden_words: Array.isArray(account.forbidden_words) ? account.forbidden_words.join('\n') : '',
      daily_post_min: account.daily_post_min ?? 2,
      daily_post_max: account.daily_post_max ?? 4,
      link_post_ratio: Number(account.link_post_ratio ?? 0.3),
      no_link_post_ratio: Number(account.no_link_post_ratio ?? 0.7),
      coupang_access_key: '',
      coupang_secret_key: '',
      coupang_partner_id: '',
      coupang_tracking_code: '',
      active_time_windows: Array.isArray(account.active_time_windows) && account.active_time_windows.length
        ? account.active_time_windows
        : [{ start: '09:00', end: '22:00' }],
    });
  }, [account]);

  const save = async () => {
    const trialBlocked = trialStatus?.plan === 'free' && trialStatus.blocked;
    if (trialBlocked) {
      toast('무료 체험 포스팅 3회를 모두 사용했습니다. 결제 후 계속 이용할 수 있습니다.', 'error');
      setTab?.('billing');
      return;
    }
    const errs = {};
    if (!form.target_audience?.trim()) errs.target_audience = '타겟 오디언스를 입력해주세요.';
    if (!form.content_scope?.trim()) errs.content_scope = '다룰 카테고리를 입력해주세요.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, {
        ...form,
        forbidden_topics: form.forbidden_topics.split('\n').map((s) => s.trim()).filter(Boolean),
        forbidden_words: form.forbidden_words.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      await reloadAccounts();
      await reloadSetupStatus?.();
      toast('설정이 변경되었습니다. 자동화를 시작합니다.', 'success');
    } catch {
      toast('저장에 실패했습니다.', 'error');
      return;
    } finally {
      setSaving(false);
    }

    const check = await runPreflight({ silent: true });
    if (!check?.canPublish) {
      toast('자동화 전에 확인할 항목이 있습니다.', 'error');
      return;
    }

    setRunning(true);
    onPipelineRunningChange?.(true, {
      percent: 0,
      stage: 'starting',
      label: '예약 작업을 준비하고 있습니다'
    });
    try {
      const result = await api.post(`/api/accounts/${account.id}/run-pipeline`, {});
      onPipelineDone?.(result);
      reloadTrialStatus?.();
    } catch (err) {
      if (err.preflight) setPreflight(err.preflight);
      toast(err.preflight ? '자동화 전에 확인할 항목이 있습니다.' : '자동화 실행에 실패했습니다. 잠시 후 자동으로 재시도됩니다.', 'error');
    } finally {
      setRunning(false);
      onPipelineRunningChange?.(false);
    }
  };

  const updateWindow = (i, key, val) => {
    setForm((p) => ({
      ...p,
      active_time_windows: p.active_time_windows.map((w, idx) => idx === i ? { ...w, [key]: val } : w)
    }));
  };

  const connectThreads = async () => {
    if (!account?.id) return;
    setConnectingThreads(true);
    try {
      const payload = await api.get(`/api/auth/threads/start?accountId=${account.id}`);
      if (payload?.url) window.location.href = payload.url;
    } catch (err) {
      toast(err.message || 'Threads 연결을 시작하지 못했습니다.', 'error');
      setConnectingThreads(false);
    }
  };
  const runPreflight = async ({ silent = false } = {}) => {
    if (!account?.id) return null;
    setChecking(true);
    try {
      const result = await api.get(`/api/accounts/${account.id}/preflight`);
      setPreflight(result);
      if (!silent) {
        toast(result.canPublish ? '작동 점검이 완료되었습니다.' : '확인할 항목이 있습니다.', result.canPublish ? 'success' : 'error');
      }
      return result;
    } catch (err) {
      const fallback = err.preflight || {
        canPublish: false,
        severity: 'error',
        checks: [{ status: 'error', title: '점검에 실패했습니다', message: err.message || '잠시 후 다시 시도해주세요.' }]
      };
      setPreflight(fallback);
      if (!silent) toast('작동 점검에 실패했습니다.', 'error');
      return fallback;
    } finally {
      setChecking(false);
    }
  };
  const updateLinkRatio = (value) => {
    const next = Number(value);
    setForm((prev) => ({
      ...prev,
      link_post_ratio: next,
      no_link_post_ratio: Number((1 - next).toFixed(2))
    }));
  };
  const connectionLabel = account.has_threads_access_token
    ? `연결됨${account.account_handle ? ` · ${account.account_handle}` : ''}`
    : '미연결';
  const connectionClass = account.has_threads_access_token ? 'text-emerald-600' : 'text-rose-500';

  if (!form) return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-400">
      계정 설정을 불러오는 중입니다.
    </div>
  );

  const linkRatio = Math.min(1, Math.max(0, Number(form.link_post_ratio ?? 0.3)));
  const trialBlocked = trialStatus?.plan === 'free' && trialStatus.blocked;

  return (
    <div className="grid gap-5">
      <TrialStatusCard trialStatus={trialStatus} onUpgrade={() => setTab?.('billing')} />

      {/* 계정 기본 정보 */}
      <Section title="계정 기본 정보">
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-gray-800">Threads 연결</div>
              <div className={`mt-0.5 text-xs font-medium ${connectionClass}`}>
                {connectionLabel}
              </div>
              {account.threads_token_status === 'refresh_failed' && (
                <div className="mt-1 text-xs font-semibold text-amber-600">토큰 갱신 실패 · 다시 연결 필요</div>
              )}
              <div className="mt-1 text-xs text-gray-400">
                이 CUJASA 계정에는 {account.account_handle || '입력한 Threads 핸들'} 계정만 연결할 수 있습니다.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingThreads(true)}
              disabled={connectingThreads}
              className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {connectingThreads ? '연결 이동 중...' : account.has_threads_access_token ? '다시 연결하기' : 'Threads 연결하기'}
            </button>
            <button
              type="button"
              onClick={() => runPreflight()}
              disabled={checking}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"
            >
              {checking ? '점검 중...' : '테스트 포스팅 점검'}
            </button>
          </div>
        </div>
        <Field label="계정 이름">
          <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="자취 꿀템" className={input} />
        </Field>
        <Field label="Threads 핸들">
          <input type="text" value={form.account_handle} onChange={(e) => setForm((p) => ({ ...p, account_handle: e.target.value }))}
            placeholder="@myhandle" className={input} />
        </Field>
      </Section>

      <Section title="쿠팡 파트너스 API 설정" desc="링크 포함 글을 만들 때 필요합니다. 비워두면 기존 저장값은 유지됩니다." collapsible>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-700">
          무료 체험은 쿠팡 API 없이도 일반 글로 시작할 수 있습니다. 링크 포함 비율을 1% 이상으로 쓰려면 아래 값을 입력해주세요.
        </div>
        <Field label="Access Key">
          <SensitiveInput
            value={form.coupang_access_key}
            onChange={(e) => setForm((p) => ({ ...p, coupang_access_key: e.target.value }))}
            placeholder={account.has_coupang_access_key ? '저장됨 - 변경 시에만 입력' : '쿠팡 Access Key'}
            inputClassName={`${input} pr-10`}
          />
        </Field>
        <Field label="Secret Key">
          <SensitiveInput
            value={form.coupang_secret_key}
            onChange={(e) => setForm((p) => ({ ...p, coupang_secret_key: e.target.value }))}
            placeholder={account.has_coupang_secret_key ? '저장됨 - 변경 시에만 입력' : '쿠팡 Secret Key'}
            inputClassName={`${input} pr-10`}
          />
        </Field>
        <Field label="Partner ID">
          <SensitiveInput
            value={form.coupang_partner_id}
            onChange={(e) => setForm((p) => ({ ...p, coupang_partner_id: e.target.value }))}
            placeholder={account.has_coupang_partner_id ? '저장됨 - 변경 시에만 입력' : 'AF로 시작하는 Partner ID'}
            inputClassName={`${input} pr-10`}
          />
        </Field>
        <Field label="Tracking Code">
          <SensitiveInput
            value={form.coupang_tracking_code}
            onChange={(e) => setForm((p) => ({ ...p, coupang_tracking_code: e.target.value }))}
            placeholder={account.has_coupang_tracking_code ? '저장됨 - 변경 시에만 입력' : '계정별 Tracking Code'}
            inputClassName={`${input} pr-10`}
          />
          <span className="text-xs text-gray-400">비워두면 고객 기본값 또는 계정 기본값을 사용합니다.</span>
        </Field>
      </Section>

      {/* 콘텐츠 설정 */}
      <Section title="콘텐츠 설정" desc="AI가 주제와 글을 생성할 때 기반이 됩니다">
        <Field label="타겟 오디언스 *">
          <input type="text" value={form.target_audience} onChange={(e) => { setForm((p) => ({ ...p, target_audience: e.target.value })); setErrors((p) => ({ ...p, target_audience: null })); }}
            placeholder="예: 30대 주부, 자취하는 직장인" className={`${input} ${errors.target_audience ? 'border-red-400' : ''}`} />
          {errors.target_audience && <span className="text-xs text-red-500">{errors.target_audience}</span>}
        </Field>
        <Field label="다룰 카테고리 *">
          <input type="text" value={form.content_scope} onChange={(e) => { setForm((p) => ({ ...p, content_scope: e.target.value })); setErrors((p) => ({ ...p, content_scope: null })); }}
            placeholder="예: 주방용품, 청소, 수납" className={`${input} ${errors.content_scope ? 'border-red-400' : ''}`} />
          {errors.content_scope && <span className="text-xs text-red-500">{errors.content_scope}</span>}
        </Field>
        <Field label="말투 / 톤">
          <input type="text" value={form.tone} onChange={(e) => setForm((p) => ({ ...p, tone: e.target.value }))}
            placeholder="예: 친근하고 솔직하게, MZ 감성" className={input} />
        </Field>
        <Field label="CTA 스타일">
          <input type="text" value={form.cta_style} onChange={(e) => setForm((p) => ({ ...p, cta_style: e.target.value }))}
            placeholder="예: 링크는 댓글에, 자세한 건 아래 링크" className={input} />
        </Field>
        <Field label="다루지 말 것 (줄바꿈으로 구분)">
          <textarea rows="3" value={form.forbidden_topics} onChange={(e) => setForm((p) => ({ ...p, forbidden_topics: e.target.value }))}
            placeholder={"의약품\n다이어트 보조제\n건강 효능 단정"} className={input} />
        </Field>
        <Field label="금지어 (줄바꿈으로 구분)">
          <textarea rows="3" value={form.forbidden_words} onChange={(e) => setForm((p) => ({ ...p, forbidden_words: e.target.value }))}
            placeholder={"100% 효과\n치료/예방\n체중감량 보장\n가르시니아"} className={input} />
        </Field>
      </Section>

      {/* 포스팅 스케줄 */}
      <Section title="포스팅 스케줄">
        <div className="grid grid-cols-2 gap-4">
          <Field label="하루 최소">
            <input type="number" min="1" max="10" value={form.daily_post_min}
              onChange={(e) => setForm((p) => ({ ...p, daily_post_min: Number(e.target.value) }))}
              className={`${input} text-center font-bold text-lg`} />
          </Field>
          <Field label="하루 최대">
            <input type="number" min="1" max="10" value={form.daily_post_max}
              onChange={(e) => setForm((p) => ({ ...p, daily_post_max: Number(e.target.value) }))}
              className={`${input} text-center font-bold text-lg`} />
          </Field>
        </div>
        <Field label="업로드 시간대">
          <div className="grid gap-3">
            {form.active_time_windows.map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <input type="time" value={w.start} onChange={(e) => updateWindow(i, 'start', e.target.value)}
                  className={`flex-1 ${input} text-center`} />
                <span className="text-gray-400 text-sm">~</span>
                <input type="time" value={w.end} onChange={(e) => updateWindow(i, 'end', e.target.value)}
                  className={`flex-1 ${input} text-center`} />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">이 시간대 안에서 랜덤하게 발행됩니다</p>
        </Field>
        <Field label="링크 포함 포스트 비율">
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-bold text-gray-700">링크 포함 {Math.round(linkRatio * 100)}%</span>
              <span className="text-gray-400">일반 글 {Math.round((1 - linkRatio) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={linkRatio}
              onChange={(e) => updateLinkRatio(e.target.value)}
              className="w-full accent-coupang"
            />
            <p className="mt-2 text-xs text-gray-400">
              계정별로 쿠팡 링크가 들어가는 글의 비율을 조절합니다. 기본값은 링크 포함 30%입니다.
            </p>
          </div>
        </Field>
      </Section>

      {running && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-700">
          <div className="font-bold mb-0.5">자동화 실행 중입니다</div>
          <div className="text-xs opacity-80">주제 생성 → 상품 검색 → 콘텐츠 작성 → 예약 순으로 진행됩니다. 완료까지 약 1~2분 소요됩니다.</div>
        </div>
      )}
      <button onClick={save} disabled={saving || running || trialBlocked}
        className={`w-full font-black py-4 rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-white
          ${running || trialBlocked ? 'bg-gray-400 cursor-not-allowed' : 'bg-coupang hover:bg-coupang-dark'}`}>
        {(saving || running) && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
        {saving ? '저장 중...' : running ? '실행 중 (잠시 기다려주세요)' : trialBlocked ? '무료 체험 종료' : '저장하고 시작하기'}
      </button>
      {confirmingThreads && (
        <ThreadsConnectModal
          account={account}
          connecting={connectingThreads}
          onCancel={() => setConfirmingThreads(false)}
          onConfirm={() => {
            setConfirmingThreads(false);
            connectThreads();
          }}
        />
      )}
      {preflight && (
        <PreflightModal
          result={preflight}
          onClose={() => setPreflight(null)}
          onReconnect={() => {
            setPreflight(null);
            setConfirmingThreads(true);
          }}
        />
      )}
    </div>
  );
}

const input = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-coupang transition-colors';

function Section({ title, desc, children, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-5 py-4 text-left ${collapsible ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'}`}
      >
        <div>
          <h3 className="font-bold text-gray-800">{title}</h3>
          {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
        </div>
        {collapsible && (
          <span className="text-gray-400 text-lg leading-none ml-4">{open ? '−' : '+'}</span>
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 grid gap-4 border-t border-gray-50">
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function ThreadsConnectModal({ account, connecting, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="text-lg font-black text-gray-900">Threads 계정 확인</div>
        <div className="mt-3 grid gap-2 text-sm leading-relaxed text-gray-600">
          <p>지금 연결하려는 CUJASA 계정은 <strong>{account.name}</strong>입니다.</p>
          <p>현재 브라우저 또는 Threads 앱에서 <strong>{account.account_handle || '이 계정의 Threads 핸들'}</strong>로 로그인되어 있어야 합니다.</p>
          <p className="text-xs text-gray-400">다른 Threads 계정으로 로그인된 상태라면 Threads에서 로그아웃한 뒤 다시 진행해주세요.</p>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-500">
            취소
          </button>
          <button type="button" onClick={onConfirm} disabled={connecting} className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-bold text-white disabled:opacity-50">
            {connecting ? '이동 중...' : '확인하고 연결'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreflightModal({ result, onClose, onReconnect }) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const errors = checks.filter((check) => check.status === 'error');
  const warnings = checks.filter((check) => check.status === 'warn');
  const oks = checks.filter((check) => check.status === 'ok');
  const needsReconnect = checks.some((check) => check.action === 'reconnect_threads');
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 border-b border-gray-100 px-6 py-5">
          <div className="text-lg font-black text-gray-900">테스트 포스팅 점검 결과</div>
          <div className={`mt-1 text-sm font-semibold ${result.canPublish ? 'text-emerald-600' : 'text-rose-600'}`}>
            {result.canPublish ? '자동화 실행이 가능합니다' : '자동화 전에 조치가 필요합니다'}
          </div>
        </div>
        <div className="grid gap-4 overflow-y-auto px-6 py-5">
          {errors.length > 0 && <CheckGroup title="바로 조치 필요" tone="error" checks={errors} />}
          {warnings.length > 0 && <CheckGroup title="주의" tone="warn" checks={warnings} />}
          {oks.length > 0 && <CheckGroup title="정상" tone="ok" checks={oks} />}
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
