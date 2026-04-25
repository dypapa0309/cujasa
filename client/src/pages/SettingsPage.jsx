import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function SettingsPage() {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.get('/api/health').then(setHealth).catch(() => setHealth({ ok: false })); }, []);
  const rows = [
    ['OpenAI 키 상태', '환경변수 OPENAI_API_KEY'],
    ['Supabase 상태', 'SUPABASE_URL / SERVICE_ROLE_KEY'],
    ['쿠팡 API 키 상태', 'COUPANG_ACCESS_KEY / SECRET_KEY'],
    ['추적 링크 도메인', 'APP_BASE_URL'],
    ['알림 설정', 'Telegram 또는 Slack']
  ];
  return (
    <div className="grid gap-4">
      <div className="rounded border border-line bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium">API 서버</span>
          <StatusBadge status={health?.ok ? 'active' : 'failed'} />
        </div>
      </div>
      <div className="overflow-hidden rounded border border-line bg-white">
        {rows.map(([label, hint]) => (
          <div key={label} className="flex items-center justify-between border-t border-line p-4 first:border-t-0">
            <div>
              <div className="font-medium">{label}</div>
              <div className="text-sm text-slate-500">{hint}</div>
            </div>
            <StatusBadge status="active" />
          </div>
        ))}
      </div>
      <button onClick={() => api.post('/api/notifications/test', { message: 'CUJASA test' })} className="w-fit rounded bg-coupang px-4 py-2 font-medium text-white">알림 테스트</button>
    </div>
  );
}
