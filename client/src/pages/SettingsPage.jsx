import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { useToast } from '../lib/toast.jsx';

export default function SettingsPage() {
  const toast = useToast();
  const [health, setHealth] = useState(null);
  const [products, setProducts] = useState([]);
  const [systemSettings, setSystemSettings] = useState({ fields: [] });
  const [systemDrafts, setSystemDrafts] = useState({});
  const [productDrafts, setProductDrafts] = useState({});
  const [notificationMessage, setNotificationMessage] = useState('CUJASA 관리자 알림 테스트입니다.');
  const [notificationResult, setNotificationResult] = useState(null);
  const [savingProductId, setSavingProductId] = useState('');
  const [savingSystemSettings, setSavingSystemSettings] = useState(false);
  const [sendingNotification, setSendingNotification] = useState(false);

  const load = async () => {
    const [nextHealth, nextProducts, nextSystemSettings] = await Promise.all([
      api.get('/api/health').catch(() => ({ ok: false })),
      api.get('/api/admin/products'),
      api.get('/api/admin/system-settings')
    ]);
    setHealth(nextHealth);
    setProducts(nextProducts);
    setSystemSettings(nextSystemSettings || { fields: [] });
    setSystemDrafts({});
    setProductDrafts(Object.fromEntries(nextProducts.map((product) => [product.id, {
      name: product.name || '',
      description: product.description || '',
      app_url: product.app_url || '',
      landing_url: product.landing_url || '',
      status: product.status || 'active'
    }])));
  };

  useEffect(() => {
    load().catch(() => toast('설정 정보를 불러오지 못했습니다.', 'error'));
  }, []);

  const updateDraft = (id, key, value) => {
    setProductDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  };

  const updateSystemDraft = (key, value) => {
    setSystemDrafts((prev) => ({ ...prev, [key]: value }));
  };

  const saveSystemSettings = async () => {
    setSavingSystemSettings(true);
    try {
      const result = await api.patch('/api/admin/system-settings', { values: systemDrafts });
      setSystemSettings((prev) => ({ ...prev, fields: result.fields || prev.fields || [] }));
      setSystemDrafts({});
      toast('시스템 API 설정을 저장했습니다. 일부 값은 서버 재시작 후 전체 작업에 반영됩니다.', 'success');
    } catch (error) {
      toast(error.message || '시스템 API 설정 저장에 실패했습니다.', 'error');
    } finally {
      setSavingSystemSettings(false);
    }
  };

  const saveProduct = async (product) => {
    setSavingProductId(product.id);
    try {
      await api.patch(`/api/admin/products/${product.id}`, productDrafts[product.id] || {});
      await load();
      toast('제품 설정을 저장했습니다.', 'success');
    } catch (error) {
      toast(error.message || '제품 설정 저장에 실패했습니다.', 'error');
    } finally {
      setSavingProductId('');
    }
  };

  const sendTestNotification = async () => {
    setSendingNotification(true);
    setNotificationResult(null);
    try {
      const result = await api.post('/api/notifications/test', { message: notificationMessage });
      setNotificationResult({ ok: true, result });
      toast('알림 테스트를 전송했습니다.', 'success');
    } catch (error) {
      setNotificationResult({ ok: false, message: error.message });
      toast(error.message || '알림 테스트에 실패했습니다.', 'error');
    } finally {
      setSendingNotification(false);
    }
  };

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-3">
        <StatusCard title="API 서버" value={health?.ok ? '정상' : '오류'} status={health?.ok ? 'active' : 'failed'} hint={health?.service || 'GET /api/health'} />
        <StatusCard title="Supabase 연결" value={health?.ok ? '확인 가능' : '확인 실패'} status={health?.ok ? 'active' : 'failed'} hint="운영 DB 접근은 각 API 호출 결과로 확인합니다." />
        <StatusCard title="알림 설정" value="테스트 가능" status="active" hint="아래에서 실제 전송 결과를 확인하세요." />
      </section>

      <section className="rounded border border-line bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold">알림 테스트</h3>
            <p className="mt-1 text-xs text-slate-400">Telegram/Slack 등 서버에 연결된 알림 채널로 테스트 메시지를 보냅니다.</p>
          </div>
          <button
            type="button"
            onClick={sendTestNotification}
            disabled={sendingNotification || !notificationMessage.trim()}
            className="rounded bg-coupang px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {sendingNotification ? '전송 중...' : '테스트 전송'}
          </button>
        </div>
        <textarea
          className="mt-4 w-full rounded border border-line px-3 py-2 text-sm"
          rows="3"
          value={notificationMessage}
          onChange={(event) => setNotificationMessage(event.target.value)}
        />
        {notificationResult && (
          <div className={`mt-3 rounded border px-4 py-3 text-sm ${notificationResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {notificationResult.ok ? '알림 전송 요청이 완료됐습니다.' : notificationResult.message}
          </div>
        )}
      </section>

      <section className="rounded border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-bold">시스템 API 설정</h3>
          <p className="mt-1 text-xs text-slate-400">JASAIN 공통으로 쓰는 Meta, OpenAI, 영상 소싱, TTS, 렌더/저장소 설정입니다. 고객 화면에는 노출하지 않습니다.</p>
        </div>
        <div className="grid gap-5 p-5">
          {Object.entries(groupFields(systemSettings.fields || [])).map(([group, fields]) => (
            <div key={group} className="rounded border border-line p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-black text-slate-900">{group}</div>
                <div className="text-xs font-semibold text-slate-400">{fields.filter((field) => field.configured).length}/{fields.length} 설정됨</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {fields.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <div className="grid gap-1">
                      <input
                        className={input}
                        type={field.secret ? 'password' : 'text'}
                        value={systemDrafts[field.key] || ''}
                        onChange={(event) => updateSystemDraft(field.key, event.target.value)}
                        placeholder={field.configured ? `${field.displayValue || '설정됨'} - 변경 시에만 입력` : field.key}
                      />
                      <div className={`text-[11px] font-semibold ${field.configured ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {field.configured ? '설정됨' : '미설정'}
                      </div>
                    </div>
                  </Field>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveSystemSettings}
              disabled={savingSystemSettings || !Object.values(systemDrafts).some((value) => String(value || '').trim())}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {savingSystemSettings ? '저장 중...' : '시스템 설정 저장'}
            </button>
            <span className="text-xs text-slate-400">빈 입력값은 기존 설정을 유지합니다.</span>
          </div>
        </div>
      </section>

      <section className="rounded border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-bold">제품/앱 URL 설정</h3>
          <p className="mt-1 text-xs text-slate-400">제품 삭제 대신 비활성화를 사용합니다. 고객 권한/결제 이력 보존을 위해 완전 삭제는 제공하지 않습니다.</p>
        </div>
        <div className="grid divide-y divide-line">
          {products.map((product) => {
            const draft = productDrafts[product.id] || {};
            return (
              <div key={product.id} className="grid gap-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">{product.id}</div>
                    <div className="text-xs text-slate-400">{product.name}</div>
                  </div>
                  <StatusBadge status={draft.status === 'active' ? 'active' : 'paused'} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="제품명">
                    <input className={input} value={draft.name || ''} onChange={(e) => updateDraft(product.id, 'name', e.target.value)} />
                  </Field>
                  <Field label="상태">
                    <select className={input} value={draft.status || 'active'} onChange={(e) => updateDraft(product.id, 'status', e.target.value)}>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="archived">archived</option>
                    </select>
                  </Field>
                  <Field label="앱 URL">
                    <input className={input} value={draft.app_url || ''} onChange={(e) => updateDraft(product.id, 'app_url', e.target.value)} />
                  </Field>
                  <Field label="랜딩 URL">
                    <input className={input} value={draft.landing_url || ''} onChange={(e) => updateDraft(product.id, 'landing_url', e.target.value)} />
                  </Field>
                  <Field label="설명">
                    <textarea className={input} rows="2" value={draft.description || ''} onChange={(e) => updateDraft(product.id, 'description', e.target.value)} />
                  </Field>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => saveProduct(product)}
                    disabled={savingProductId === product.id}
                    className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {savingProductId === product.id ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const input = 'w-full rounded border border-line px-3 py-2 text-sm';

function groupFields(fields = []) {
  return fields.reduce((acc, field) => {
    const group = field.group || '기타';
    acc[group] = [...(acc[group] || []), field];
    return acc;
  }, {});
}

function StatusCard({ title, value, status, hint }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-400">{title}</div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-2 text-lg font-black text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}
