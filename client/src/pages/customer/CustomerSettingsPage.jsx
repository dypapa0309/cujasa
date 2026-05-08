import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';
import SensitiveInput from '../../components/SensitiveInput.jsx';
import TrialStatusCard from './TrialStatusCard.jsx';
import ErrorReportButton from '../../components/ErrorReportButton.jsx';
import {
  commentStyleOptions,
  contentIntensityOptions,
  contentModeOptions,
  emojiLevelOptions,
  productMentionOptions
} from '../../config/contentStrategy.js';

const MAX_DAILY_POSTS = 5;

function clampDailyPostCount(value, fallback = 1) {
  const number = Number(value);
  return Math.min(MAX_DAILY_POSTS, Math.max(0, Number.isFinite(number) ? number : fallback));
}

export default function CustomerSettingsPage({ account, currentUser, reloadAccounts, trialStatus, reloadSetupStatus, setTab }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [connectingThreads, setConnectingThreads] = useState(false);
  const [confirmingThreads, setConfirmingThreads] = useState(false);
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
      content_mode: account.content_mode || 'empathy',
      content_intensity: account.content_intensity || 'normal',
      seasonality_enabled: account.seasonality_enabled !== false,
      comment_induction_style: account.comment_induction_style || 'soft_question',
      product_mention_style: account.product_mention_style || 'natural',
      emoji_level: account.emoji_level || 'low',
      safe_debate_enabled: Boolean(account.safe_debate_enabled),
      content_style_note: account.content_style_note || '',
      forbidden_topics: Array.isArray(account.forbidden_topics) ? account.forbidden_topics.join('\n') : '',
      forbidden_words: Array.isArray(account.forbidden_words) ? account.forbidden_words.join('\n') : '',
      daily_post_min: 0,
      daily_post_max: clampDailyPostCount(account.daily_post_max, 5),
      coupang_access_key: '',
      coupang_secret_key: '',
      coupang_partner_id: '',
      coupang_tracking_code: '',
      first_upload_time: Array.isArray(account.active_time_windows) && account.active_time_windows[0]?.start
        ? account.active_time_windows[0].start
        : '09:00',
    });
  }, [account]);

  const save = async () => {
    const trialBlocked = trialStatus?.plan === 'free' && trialStatus.blocked;
    if (trialBlocked) {
      toast('무료 체험 포스팅 5회를 모두 사용했습니다. 결제 후 계속 이용할 수 있습니다.', 'error');
      setTab?.('billing');
      return;
    }
    const errs = {};
    if (!form.target_audience?.trim()) errs.target_audience = '타겟층을 입력해주세요.';
    if (!form.content_scope?.trim()) errs.content_scope = '다룰 카테고리를 입력해주세요.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      const { first_upload_time, ...accountPatch } = form;
      await api.patch(`/api/accounts/${account.id}`, {
        ...accountPatch,
        daily_post_min: 0,
        daily_post_max: clampDailyPostCount(form.daily_post_max, 5),
        active_time_windows: [{ start: first_upload_time || '09:00', end: first_upload_time || '09:00' }],
        forbidden_topics: form.forbidden_topics.split('\n').map((s) => s.trim()).filter(Boolean),
        forbidden_words: form.forbidden_words.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      await reloadAccounts();
      await reloadSetupStatus?.();
      toast('설정이 저장되었습니다.', 'success');
      setErrors((prev) => ({ ...prev, save: null }));
    } catch (error) {
      toast(error.message || '설정을 저장하지 못했습니다.', 'error');
      setErrors((prev) => ({
        ...prev,
        save: {
          message: error.message || '설정을 저장하지 못했습니다.',
          code: error.code || 'SETTINGS_SAVE_FAILED'
        }
      }));
    } finally {
      setSaving(false);
    }
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
  const updateContentMode = (value) => {
    setForm((prev) => ({
      ...prev,
      content_mode: value,
      safe_debate_enabled: value === 'safe_debate' ? true : prev.safe_debate_enabled
    }));
  };
  const revealSensitiveAccountField = async (field) => {
    if (!account?.id) return '';
    const payload = await api.get(`/api/accounts/${account.id}/sensitive/${field}`);
    return payload?.value || '';
  };
  const archiveCurrentAccount = async () => {
    if (!account?.id || archiving) return;
    setArchiving(true);
    try {
      await api.delete(`/api/accounts/${account.id}`);
      await reloadAccounts?.();
      await reloadSetupStatus?.();
      setConfirmingArchive(false);
      setTab?.('home');
      toast('계정을 보관했습니다. 예약/게시/분석 기록은 유지됩니다.', 'success');
    } catch (error) {
      toast(error.message || '계정 보관에 실패했습니다.', 'error');
    } finally {
      setArchiving(false);
    }
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
              {!account.has_threads_access_token && (
                <div className="mt-1 text-xs text-amber-600">
                  Threads 앱만 로그인되어 있으면 실패할 수 있습니다. Chrome/Safari에서 threads.net 로그인 상태를 확인해주세요.
                </div>
              )}
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
              onClick={() => setTab?.('run')}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"
            >
              자동화 실행 탭으로
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
          CUJASA는 실제 쿠팡 상품 링크가 매칭된 글만 자동 업로드합니다. 매칭 가능한 상품이 없는 날은 품질 보호를 위해 업로드하지 않습니다.
        </div>
        <Field label="Access Key">
          <SensitiveInput
            value={form.coupang_access_key}
            onChange={(e) => setForm((p) => ({ ...p, coupang_access_key: e.target.value }))}
            placeholder={account.has_coupang_access_key ? '저장됨 - 변경 시에만 입력' : '쿠팡 Access Key'}
            hasStoredValue={account.has_coupang_access_key}
            onRevealStored={() => revealSensitiveAccountField('coupang_access_key')}
            inputClassName={`${input} pr-10`}
          />
        </Field>
        <Field label="Secret Key">
          <SensitiveInput
            value={form.coupang_secret_key}
            onChange={(e) => setForm((p) => ({ ...p, coupang_secret_key: e.target.value }))}
            placeholder={account.has_coupang_secret_key ? '저장됨 - 변경 시에만 입력' : '쿠팡 Secret Key'}
            hasStoredValue={account.has_coupang_secret_key}
            onRevealStored={() => revealSensitiveAccountField('coupang_secret_key')}
            inputClassName={`${input} pr-10`}
          />
        </Field>
        <Field label="Partner ID">
          <SensitiveInput
            value={form.coupang_partner_id}
            onChange={(e) => setForm((p) => ({ ...p, coupang_partner_id: e.target.value }))}
            placeholder={account.has_coupang_partner_id ? '저장됨 - 변경 시에만 입력' : 'AF로 시작하는 Partner ID'}
            hasStoredValue={account.has_coupang_partner_id}
            onRevealStored={() => revealSensitiveAccountField('coupang_partner_id')}
            inputClassName={`${input} pr-10`}
          />
        </Field>
        <Field label="Tracking Code">
          <SensitiveInput
            value={form.coupang_tracking_code}
            onChange={(e) => setForm((p) => ({ ...p, coupang_tracking_code: e.target.value }))}
            placeholder={account.has_coupang_tracking_code ? '저장됨 - 변경 시에만 입력' : '계정별 Tracking Code'}
            hasStoredValue={account.has_coupang_tracking_code}
            onRevealStored={() => revealSensitiveAccountField('coupang_tracking_code')}
            inputClassName={`${input} pr-10`}
          />
          <span className="text-xs text-gray-400">비워두면 고객 기본값 또는 계정 기본값을 사용합니다.</span>
        </Field>
      </Section>

      {/* 콘텐츠 설정 */}
      <Section title="콘텐츠 설정" desc="AI가 주제와 글을 생성할 때 기반이 됩니다" collapsible>
        <Field label="타겟층 *">
          <input type="text" value={form.target_audience} onChange={(e) => { setForm((p) => ({ ...p, target_audience: e.target.value })); setErrors((p) => ({ ...p, target_audience: null })); }}
            placeholder="예: 30대 주부, 자취하는 직장인" className={`${input} ${errors.target_audience ? 'border-red-400' : ''}`} />
          {errors.target_audience && <span className="text-xs text-red-500">{errors.target_audience}</span>}
        </Field>
        <Field label="다룰 카테고리 *">
          <input type="text" value={form.content_scope} onChange={(e) => { setForm((p) => ({ ...p, content_scope: e.target.value })); setErrors((p) => ({ ...p, content_scope: null })); }}
            placeholder="예: 주방용품, 청소, 수납" className={`${input} ${errors.content_scope ? 'border-red-400' : ''}`} />
          {errors.content_scope && <span className="text-xs text-red-500">{errors.content_scope}</span>}
        </Field>
        <div className="grid gap-3">
          <div>
            <div className="text-sm font-bold text-gray-800">콘텐츠 방식</div>
            <div className="mt-1 text-xs text-gray-400">선택한 방식이 말투 메모보다 우선 반영됩니다.</div>
          </div>
          <div className="grid gap-2">
            {contentModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => updateContentMode(option.value)}
                className={`rounded-xl border px-4 py-3 text-left text-sm ${form.content_mode === option.value ? 'border-coupang bg-blue-50 text-coupang' : 'border-gray-100 bg-white text-gray-600'}`}
              >
                <div className="font-black">{option.label}</div>
                <div className="mt-1 text-xs text-gray-400">{option.description}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="강도" value={form.content_intensity} onChange={(value) => setForm((p) => ({ ...p, content_intensity: value }))} options={contentIntensityOptions} />
          <SelectField label="댓글 유도" value={form.comment_induction_style} onChange={(value) => setForm((p) => ({ ...p, comment_induction_style: value }))} options={commentStyleOptions} />
          <SelectField label="상품 언급" value={form.product_mention_style} onChange={(value) => setForm((p) => ({ ...p, product_mention_style: value }))} options={productMentionOptions} />
          <SelectField label="이모지" value={form.emoji_level} onChange={(value) => setForm((p) => ({ ...p, emoji_level: value }))} options={emojiLevelOptions} />
        </div>
        <div className="grid gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span className="font-bold text-gray-700">계절감 반영</span>
            <input type="checkbox" checked={form.seasonality_enabled} onChange={(e) => setForm((p) => ({ ...p, seasonality_enabled: e.target.checked }))} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-bold text-gray-700">안전 논쟁형 허용</span>
              <span className="text-xs text-gray-400">비하/혐오 없이 취향 차이 질문만 사용합니다.</span>
            </span>
            <input
              type="checkbox"
              checked={form.safe_debate_enabled}
              onChange={(e) => setForm((p) => ({
                ...p,
                safe_debate_enabled: e.target.checked,
                content_mode: !e.target.checked && p.content_mode === 'safe_debate' ? 'question' : p.content_mode
              }))}
            />
          </label>
        </div>
        <Field label="추가 요청사항">
          <textarea rows="3" value={form.content_style_note} onChange={(e) => setForm((p) => ({ ...p, content_style_note: e.target.value }))}
            placeholder="예: 너무 광고처럼 쓰지 말기, 자취생 말투 유지" className={input} />
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
      <Section title="포스팅 스케줄" collapsible>
        <Field label="하루 최대 포스팅">
          <input type="number" min="0" max={MAX_DAILY_POSTS} value={form.daily_post_max}
            onChange={(e) => setForm((p) => ({ ...p, daily_post_max: clampDailyPostCount(e.target.value, 5) }))}
            className={`${input} text-center font-bold text-lg`} />
        </Field>
        <Field label="분산 기준 시각">
          <input
            type="time"
            value={form.first_upload_time}
            onChange={(e) => setForm((p) => ({ ...p, first_upload_time: e.target.value }))}
            className={`${input} text-center font-bold`}
          />
          <p className="text-xs text-gray-400 mt-2">하루 여러 개를 예약하면 이 시각부터 일정 간격으로 배치됩니다.</p>
        </Field>
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-500">
          하루 최대 개수는 보장 수량이 아니라 상한입니다. 실제 쿠팡 상품 매칭이 완료된 콘텐츠가 있을 때만 예약됩니다.
        </div>
      </Section>

      <button onClick={save} disabled={saving || trialBlocked}
        className={`w-full font-black py-4 rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-white
          ${trialBlocked ? 'bg-gray-400 cursor-not-allowed' : 'bg-coupang hover:bg-coupang-dark'}`}>
        {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
        {saving ? '저장 중...' : trialBlocked ? '무료 체험 종료' : '설정 저장'}
      </button>
      {errors.save && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="font-black">설정을 저장하지 못했어요</div>
          <div className="mt-1 text-xs leading-relaxed">{errors.save.message}</div>
          <div className="mt-3">
            <ErrorReportButton
              account={account}
              currentUser={currentUser}
              context={{
                message: errors.save.message,
                code: errors.save.code,
                apiSummary: { form: { ...form, coupang_access_key: undefined, coupang_secret_key: undefined } }
              }}
            />
          </div>
        </div>
      )}
      <Section title="계정 보관/삭제" desc="사용하지 않는 계정은 목록에서 숨기고 자동화를 중지합니다.">
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-700">
          고객용 계정 삭제는 복구 가능한 보관 처리입니다. 예약/게시/분석 기록은 보관되고, 자동화는 중지됩니다.
        </div>
        <button
          type="button"
          onClick={() => setConfirmingArchive(true)}
          disabled={archiving}
          className="w-full rounded-2xl border border-rose-200 bg-white py-4 text-sm font-black text-rose-600 disabled:opacity-50"
        >
          {archiving ? '보관 중...' : '계정 보관하기'}
        </button>
      </Section>
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
      {confirmingArchive && (
        <ArchiveAccountModal
          account={account}
          archiving={archiving}
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={archiveCurrentAccount}
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

function SelectField({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
}

function ThreadsConnectModal({ account, connecting, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="text-lg font-black text-gray-900">Threads 계정 확인</div>
        <div className="mt-3 grid gap-2 text-sm leading-relaxed text-gray-600">
          <p>지금 연결하려는 CUJASA 계정은 <strong>{account.name}</strong>입니다.</p>
          <p>연결 버튼을 누르면 브라우저에서 threads.net이 열립니다. <strong>Chrome/Safari 브라우저</strong>에 <strong>{account.account_handle || '이 계정의 Threads 핸들'}</strong>로 로그인되어 있어야 합니다.</p>
          <p className="text-xs text-amber-600">Threads 앱만 로그인되어 있으면 연결되지 않을 수 있습니다. 모바일에서 Threads 앱이 자동으로 열리면 Chrome/Safari에서 threads.net에 먼저 로그인한 뒤 다시 진행해주세요.</p>
          <p className="text-xs text-gray-400">다른 Threads 계정이 뜨면 브라우저에서 로그아웃 후 올바른 계정으로 다시 로그인해주세요.</p>
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

function ArchiveAccountModal({ account, archiving, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="text-lg font-black text-gray-900">계정 보관</div>
        <div className="mt-3 grid gap-2 text-sm leading-relaxed text-gray-600">
          <p><strong>{account.name}</strong> 계정을 고객 화면에서 숨기고 자동화를 중지합니다.</p>
          <p className="text-xs text-gray-500">예약/게시/분석 기록은 보관됩니다. 완전 삭제가 필요하면 관리자에게 요청해주세요.</p>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={archiving} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-500 disabled:opacity-50">
            취소
          </button>
          <button type="button" onClick={onConfirm} disabled={archiving} className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white disabled:opacity-50">
            {archiving ? '보관 중...' : '보관하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
