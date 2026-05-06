import SensitiveInput from './SensitiveInput.jsx';
import {
  commentStyleOptions,
  contentIntensityOptions,
  contentModeOptions,
  emojiLevelOptions,
  productMentionOptions
} from '../config/contentStrategy.js';

const sensitiveKeys = new Set([
  'threads_access_token',
  'coupang_access_key',
  'coupang_secret_key',
  'coupang_partner_id',
  'coupang_tracking_code'
]);
const MAX_DAILY_POSTS = 5;

export default function SettingsForm({ form, setForm, onSubmit, saving, onRevealSensitive }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateContentMode = (value) => setForm((prev) => ({
    ...prev,
    content_mode: value,
    safe_debate_enabled: value === 'safe_debate' ? true : prev.safe_debate_enabled
  }));
  const updateList = (key, value) => update(key, value.split('\n').map((item) => item.trim()).filter(Boolean));
  const windows = form.active_time_windows?.length ? form.active_time_windows : [{ start: '09:00', end: '11:00' }];
  const updateWindow = (index, key, value) => {
    const next = windows.map((window, i) => i === index ? { ...window, [key]: value } : window);
    update('active_time_windows', next);
  };
  const addWindow = () => update('active_time_windows', [...windows, { start: '20:00', end: '23:00' }]);
  const removeWindow = (index) => update('active_time_windows', windows.filter((_, i) => i !== index));

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded border border-line bg-white p-5 md:grid-cols-2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 md:col-span-2">
        <div>
          <div className="text-sm font-bold text-slate-800">계정 설정 수정</div>
          <div className="mt-1 text-xs text-slate-400">필요한 값을 고친 뒤 저장하면 이 계정에 바로 반영됩니다.</div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="focus-ring flex items-center gap-2 rounded bg-coupang px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
          {saving ? '저장 중...' : '수정 저장'}
        </button>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">상태</span>
        <select className="rounded border border-line px-3 py-2" value={form.status || 'active'} onChange={(e) => update('status', e.target.value)}>
          <option value="active">active</option>
          <option value="paused">paused</option>
          <option value="archived">archived</option>
        </select>
      </label>
      {[
        ['name', '계정명', 'text'],
        ['account_handle', '핸들', 'text'],
        ['target_audience', '타겟층', 'text'],
        ['content_scope', '주제 범위', 'text'],
        ['threads_access_token', 'Threads 액세스 토큰', 'password'],
        ['coupang_access_key', '쿠팡 Access Key', 'text'],
        ['coupang_secret_key', '쿠팡 Secret Key', 'password'],
        ['coupang_partner_id', '쿠팡 Partner ID', 'text'],
        ['coupang_tracking_code', '쿠팡 Tracking Code', 'text']
      ].map(([key, label, type]) => (
        <label key={key} className="grid gap-1 text-sm">
          <span className="font-medium">{label}</span>
          {sensitiveKeys.has(key) ? (
            <SensitiveInput
              value={form[key] || ''}
              placeholder={form[`has_${key}`] ? (form[`masked_${key}`] || '저장됨 - 변경 시에만 입력') : ''}
              hasStoredValue={Boolean(form[`has_${key}`])}
              onRevealStored={() => onRevealSensitive?.(key)}
              onChange={(e) => update(key, e.target.value)}
            />
          ) : (
            <input type={type} className="rounded border border-line px-3 py-2" value={form[key] || ''} onChange={(e) => update(key, e.target.value)} />
          )}
        </label>
      ))}
      <div className="grid gap-4 rounded border border-line p-4 md:col-span-2">
        <div>
          <div className="text-sm font-bold text-slate-800">콘텐츠 방식</div>
          <div className="mt-1 text-xs text-slate-400">자유 입력보다 아래 선택값이 생성에 우선 반영됩니다.</div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {contentModeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateContentMode(option.value)}
              className={`rounded border px-3 py-2 text-left text-sm ${form.content_mode === option.value ? 'border-coupang bg-blue-50 text-coupang' : 'border-line bg-white text-slate-600'}`}
            >
              <div className="font-bold">{option.label}</div>
              <div className="mt-1 text-xs text-slate-400">{option.description}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <SelectField label="강도" value={form.content_intensity || 'normal'} onChange={(value) => update('content_intensity', value)} options={contentIntensityOptions} />
          <SelectField label="댓글 유도" value={form.comment_induction_style || 'soft_question'} onChange={(value) => update('comment_induction_style', value)} options={commentStyleOptions} />
          <SelectField label="상품 언급" value={form.product_mention_style || 'natural'} onChange={(value) => update('product_mention_style', value)} options={productMentionOptions} />
          <SelectField label="이모지" value={form.emoji_level || 'low'} onChange={(value) => update('emoji_level', value)} options={emojiLevelOptions} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.seasonality_enabled !== false} onChange={(e) => update('seasonality_enabled', e.target.checked)} />
            계절감 반영
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(form.safe_debate_enabled)}
              onChange={(e) => setForm((prev) => ({
                ...prev,
                safe_debate_enabled: e.target.checked,
                content_mode: !e.target.checked && prev.content_mode === 'safe_debate' ? 'question' : prev.content_mode
              }))}
            />
            안전 논쟁형 허용
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">추가 요청사항</span>
          <textarea rows="3" className="rounded border border-line px-3 py-2" value={form.content_style_note || ''} onChange={(e) => update('content_style_note', e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1 text-sm md:col-span-2">
        <span className="font-medium">금지 주제</span>
        <textarea
          rows="3"
          className="rounded border border-line px-3 py-2"
          value={(form.forbidden_topics || []).join('\n')}
          onChange={(e) => updateList('forbidden_topics', e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        <span className="font-medium">금지어</span>
        <textarea
          rows="3"
          className="rounded border border-line px-3 py-2"
          value={(form.forbidden_words || []).join('\n')}
          onChange={(e) => updateList('forbidden_words', e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">하루 최대 업로드</span>
        <input type="number" min="0" max={MAX_DAILY_POSTS} className="rounded border border-line px-3 py-2" value={form.daily_post_max ?? 5} onChange={(e) => update('daily_post_max', Math.min(MAX_DAILY_POSTS, Math.max(0, Number(e.target.value))))} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">최소 간격(분)</span>
        <input type="number" className="rounded border border-line px-3 py-2" value={form.min_interval_minutes || 50} onChange={(e) => update('min_interval_minutes', Number(e.target.value))} />
      </label>
      <div className="grid gap-1 rounded border border-line bg-slate-50 px-3 py-2 text-sm">
        <span className="font-medium">업로드 기준</span>
        <span className="text-xs leading-relaxed text-slate-500">수익화 가능한 쿠팡 상품이 매칭된 글만 최대 5개까지 예약합니다.</span>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">주당 휴식일 수</span>
        <input type="number" min="0" max="7" className="rounded border border-line px-3 py-2" value={form.rest_days_per_week ?? 1} onChange={(e) => update('rest_days_per_week', Number(e.target.value))} />
      </label>
      <div className="grid gap-3 rounded border border-line p-4 md:col-span-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">활성 시간대</span>
          <button type="button" onClick={addWindow} className="rounded border border-line px-3 py-1 text-sm">추가</button>
        </div>
        {windows.map((window, index) => (
          <div key={`${window.start}-${window.end}-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input type="time" className="rounded border border-line px-3 py-2" value={window.start || '09:00'} onChange={(e) => updateWindow(index, 'start', e.target.value)} />
            <input type="time" className="rounded border border-line px-3 py-2" value={window.end || '11:00'} onChange={(e) => updateWindow(index, 'end', e.target.value)} />
            <button type="button" onClick={() => removeWindow(index)} disabled={windows.length === 1} className="rounded border border-line px-3 py-2 text-sm disabled:opacity-40">삭제</button>
          </div>
        ))}
      </div>
      <div className="md:col-span-2">
        <button disabled={saving} className="focus-ring flex items-center gap-2 rounded bg-coupang px-4 py-2 font-medium text-white disabled:opacity-60">
          {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select className="rounded border border-line px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
