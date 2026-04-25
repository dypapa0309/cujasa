import { useEffect, useState } from 'react';
import { LayoutDashboard, Settings, Users, Wand2, Boxes, ListChecks, BarChart3 } from 'lucide-react';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountListPage from './pages/AccountListPage.jsx';
import AccountSettingsPage from './pages/AccountSettingsPage.jsx';
import GeneratePage from './pages/GeneratePage.jsx';
import ProductResultPage from './pages/ProductResultPage.jsx';
import QueuePage from './pages/QueuePage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { api, getAuthToken, setAuthToken } from './lib/api.js';

const icons = { dashboard: LayoutDashboard, accounts: Users, generate: Wand2, products: Boxes, queue: ListChecks, analytics: BarChart3, settings: Settings };
const tabs = [
  ['dashboard', '대시보드'],
  ['accounts', '계정 관리'],
  ['generate', '주제/콘텐츠 생성'],
  ['products', '상품 추천 결과'],
  ['queue', '업로드 큐'],
  ['analytics', '애널리틱스'],
  ['settings', '설정']
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [admin, setAdmin] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0];

  const loadAccounts = async () => {
    const rows = await api.get('/api/accounts');
    setAccounts(rows);
    if (!selectedAccountId && rows[0]) setSelectedAccountId(rows[0].id);
  };

  useEffect(() => {
    api.get('/api/auth/me')
      .then((result) => {
        setAdmin(result.admin || { email: 'dev-local' });
        return loadAccounts();
      })
      .catch(() => {
        setAuthToken('');
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  if (checkingAuth) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">인증 상태 확인 중</div>;
  }

  if (!admin && !getAuthToken()) {
    return <LoginPage onLogin={(nextAdmin) => { setAdmin(nextAdmin); loadAccounts().catch(console.error); }} />;
  }

  const Page = {
    dashboard: DashboardPage,
    accounts: AccountListPage,
    generate: GeneratePage,
    products: ProductResultPage,
    queue: QueuePage,
    analytics: AnalyticsPage,
    settings: SettingsPage
  }[page];

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white p-4 md:block">
        <div className="px-2">
          <div className="text-lg font-bold">CUJASA</div>
          <div className="mt-1 text-sm text-slate-500">쿠팡 파트너스 자동화</div>
        </div>
        <nav className="mt-6 grid gap-1">
          {tabs.map(([key, label]) => {
            const Icon = icons[key];
            return (
              <button key={key} onClick={() => setPage(key)} className={`flex items-center gap-3 rounded px-3 py-2 text-left text-sm ${page === key ? 'bg-coupang text-white' : 'hover:bg-panel'}`}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="md:pl-64">
        <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold">{tabs.find(([key]) => key === page)?.[1]}</h1>
              <p className="text-sm text-slate-500">운영 단위: 계정</p>
            </div>
            <select className="rounded border border-line px-3 py-2 text-sm" value={selectedAccount?.id || ''} onChange={(e) => setSelectedAccountId(e.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <button onClick={() => { setAuthToken(''); setAdmin(null); }} className="rounded border border-line px-3 py-2 text-sm">로그아웃</button>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto md:hidden">
            {tabs.map(([key, label]) => <button key={key} onClick={() => setPage(key)} className={`shrink-0 rounded px-3 py-2 text-sm ${page === key ? 'bg-coupang text-white' : 'bg-panel'}`}>{label}</button>)}
          </div>
        </header>
        <section className="p-5">
          <Page accounts={accounts} selectedAccount={selectedAccount} reloadAccounts={loadAccounts} setSelectedAccountId={setSelectedAccountId} />
        </section>
      </main>
    </div>
  );
}
