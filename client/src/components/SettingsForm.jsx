export default function SettingsForm({ form, setForm, onSubmit, saving }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
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
        ['target_audience', '타깃', 'text'],
        ['content_scope', '주제 범위', 'text'],
        ['tone', '톤', 'text'],
        ['cta_style', 'CTA 스타일', 'text'],
        ['threads_access_token', 'Threads 액세스 토큰', 'password'],
        ['coupang_access_key', '쿠팡 Access Key', 'text'],
        ['coupang_secret_key', '쿠팡 Secret Key', 'password'],
        ['coupang_partner_id', '쿠팡 Partner ID', 'text'],
        ['coupang_tracking_code', '쿠팡 Tracking Code', 'text']
      ].map(([key, label, type]) => (
        <label key={key} className="grid gap-1 text-sm">
          <span className="font-medium">{label}</span>
          <input type={type} className="rounded border border-line px-3 py-2" value={form[key] || ''} onChange={(e) => update(key, e.target.value)} />
        </label>
      ))}
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
        <span className="font-medium">하루 최소 업로드</span>
        <input type="number" className="rounded border border-line px-3 py-2" value={form.daily_post_min || 1} onChange={(e) => update('daily_post_min', Number(e.target.value))} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">하루 최대 업로드</span>
        <input type="number" className="rounded border border-line px-3 py-2" value={form.daily_post_max || 3} onChange={(e) => update('daily_post_max', Number(e.target.value))} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">최소 간격(분)</span>
        <input type="number" className="rounded border border-line px-3 py-2" value={form.min_interval_minutes || 50} onChange={(e) => update('min_interval_minutes', Number(e.target.value))} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">링크 포함 비율</span>
        <input type="range" step="0.05" min="0" max="1" className="accent-coupang" value={form.link_post_ratio ?? 0.3} onChange={(e) => {
          const value = Number(e.target.value);
          setForm((prev) => ({ ...prev, link_post_ratio: value, no_link_post_ratio: Number((1 - value).toFixed(2)) }));
        }} />
        <span className="text-xs text-slate-500">{Math.round((form.link_post_ratio ?? 0.3) * 100)}%</span>
      </label>
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
