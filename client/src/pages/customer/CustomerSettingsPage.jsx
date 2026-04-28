import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';

export default function CustomerSettingsPage({ account, reloadAccounts }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  useEffect(() => {
    if (!account) return;
    setForm({
      name: account.name || '',
      account_handle: account.account_handle || '',
      target_audience: account.target_audience || '',
      content_scope: account.content_scope || '',
      tone: account.tone || '',
      cta_style: account.cta_style || '',
      forbidden_topics: (account.forbidden_topics || []).join('\n'),
      forbidden_words: (account.forbidden_words || []).join('\n'),
      threads_access_token: account.threads_access_token || '',
      coupang_access_key: account.coupang_access_key || '',
      coupang_secret_key: account.coupang_secret_key || '',
      coupang_partner_id: account.coupang_partner_id || '',
      coupang_tracking_code: account.coupang_tracking_code || '',
      daily_post_min: account.daily_post_min ?? 2,
      daily_post_max: account.daily_post_max ?? 4,
      active_time_windows: account.active_time_windows?.length
        ? account.active_time_windows
        : [{ start: '09:00', end: '22:00' }],
    });
  }, [account?.id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, {
        ...form,
        forbidden_topics: form.forbidden_topics.split('\n').map((s) => s.trim()).filter(Boolean),
        forbidden_words: form.forbidden_words.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      await reloadAccounts();
      toast('저장됐습니다.', 'success');
    } catch {
      toast('저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateWindow = (i, key, val) => {
    setForm((p) => ({
      ...p,
      active_time_windows: p.active_time_windows.map((w, idx) => idx === i ? { ...w, [key]: val } : w)
    }));
  };

  if (!form) return null;

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
        <Field label="타겟 오디언스">
          <input type="text" value={form.target_audience} onChange={(e) => setForm((p) => ({ ...p, target_audience: e.target.value }))}
            placeholder="예: 30대 주부, 자취하는 직장인" className={input} />
        </Field>
        <Field label="다룰 카테고리">
          <input type="text" value={form.content_scope} onChange={(e) => setForm((p) => ({ ...p, content_scope: e.target.value }))}
            placeholder="예: 주방용품, 청소, 수납" className={input} />
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
            placeholder={"정치\n다이어트 약\n의약품"} className={input} />
        </Field>
        <Field label="금지어 (줄바꿈으로 구분)">
          <textarea rows="3" value={form.forbidden_words} onChange={(e) => setForm((p) => ({ ...p, forbidden_words: e.target.value }))}
            placeholder={"100% 효과\n치료\n보장"} className={input} />
        </Field>
      </Section>

      {/* Threads 연결 */}
      <Section title="Threads 연결" collapsible>
        <Field label="액세스 토큰">
          <div className="relative">
            <input type={showToken ? 'text' : 'password'} value={form.threads_access_token}
              onChange={(e) => setForm((p) => ({ ...p, threads_access_token: e.target.value }))}
              placeholder="Threads 액세스 토큰 입력" className={`${input} pr-16`} />
            <button type="button" onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
              {showToken ? '숨기기' : '보기'}
            </button>
          </div>
        </Field>
        {!form.threads_access_token && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
            토큰이 없으면 포스팅이 실제로 올라가지 않습니다.
          </div>
        )}
      </Section>

      {/* 쿠팡 파트너스 */}
      <Section title="쿠팡 파트너스 API" desc="쿠팡 파트너스 사이트 → Open API에서 확인할 수 있습니다" collapsible>
        <Field label="Access Key">
          <input type="text" value={form.coupang_access_key} onChange={(e) => setForm((p) => ({ ...p, coupang_access_key: e.target.value }))}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={input} />
        </Field>
        <Field label="Secret Key">
          <div className="relative">
            <input type={showSecretKey ? 'text' : 'password'} value={form.coupang_secret_key}
              onChange={(e) => setForm((p) => ({ ...p, coupang_secret_key: e.target.value }))}
              placeholder="Secret Key" className={`${input} pr-16`} />
            <button type="button" onClick={() => setShowSecretKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
              {showSecretKey ? '숨기기' : '보기'}
            </button>
          </div>
        </Field>
        <Field label="Partner ID">
          <input type="text" value={form.coupang_partner_id} onChange={(e) => setForm((p) => ({ ...p, coupang_partner_id: e.target.value }))}
            placeholder="AF0000000" className={input} />
        </Field>
        <Field label="Tracking Code">
          <input type="text" value={form.coupang_tracking_code} onChange={(e) => setForm((p) => ({ ...p, coupang_tracking_code: e.target.value }))}
            placeholder="트래킹 코드 (서브ID)" className={input} />
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

      <button onClick={save} disabled={saving}
        className="w-full bg-coupang hover:bg-coupang-dark text-white font-black py-4 rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
        {saving ? '저장 중...' : '저장하기'}
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
