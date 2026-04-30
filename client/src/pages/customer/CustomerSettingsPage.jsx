import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';

export default function CustomerSettingsPage({ account, reloadAccounts, onPipelineDone, onPipelineRunningChange }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
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
      active_time_windows: Array.isArray(account.active_time_windows) && account.active_time_windows.length
        ? account.active_time_windows
        : [{ start: '09:00', end: '22:00' }],
    });
  }, [account]);

  const save = async () => {
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
      toast('저장됐습니다. 자동화를 시작합니다.', 'success');
    } catch {
      toast('저장에 실패했습니다.', 'error');
      return;
    } finally {
      setSaving(false);
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
    } catch {
      toast('자동화 실행에 실패했습니다. 잠시 후 자동으로 재시도됩니다.', 'error');
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

  if (!form) return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-400">
      계정 설정을 불러오는 중입니다.
    </div>
  );

  return (
    <div className="grid gap-5">

      {/* 계정 기본 정보 */}
      <Section title="계정 기본 정보">
        <Field label="계정 이름">
          <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="자취 꿀템" className={input} />
        </Field>
        <Field label="Threads 핸들">
          <input type="text" value={form.account_handle} onChange={(e) => setForm((p) => ({ ...p, account_handle: e.target.value }))}
            placeholder="@myhandle" className={input} />
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
      </Section>

      {running && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-700">
          <div className="font-bold mb-0.5">자동화 실행 중입니다</div>
          <div className="text-xs opacity-80">주제 생성 → 상품 검색 → 콘텐츠 작성 → 예약 순으로 진행됩니다. 완료까지 약 1~2분 소요됩니다.</div>
        </div>
      )}
      <button onClick={save} disabled={saving || running}
        className={`w-full font-black py-4 rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-white
          ${running ? 'bg-gray-400 cursor-not-allowed' : 'bg-coupang hover:bg-coupang-dark'}`}>
        {(saving || running) && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
        {saving ? '저장 중...' : running ? '실행 중 (잠시 기다려주세요)' : '저장하고 시작하기'}
      </button>
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
