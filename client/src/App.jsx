import { useEffect, useState } from 'react';
import { ToastProvider } from './lib/toast.jsx';
import { LayoutDashboard, Settings, Users, Wand2, Boxes, ListChecks, BarChart3, ShieldCheck, Megaphone } from 'lucide-react';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountListPage from './pages/AccountListPage.jsx';
import AccountSettingsPage from './pages/AccountSettingsPage.jsx';
import GeneratePage from './pages/GeneratePage.jsx';
import ProductResultPage from './pages/ProductResultPage.jsx';
import QueuePage from './pages/QueuePage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminAnnouncementsPage from './pages/AdminAnnouncementsPage.jsx';
import CustomerApp from './pages/customer/CustomerApp.jsx';
import { api, getAuthToken, setAuthToken } from './lib/api.js';
import { CURRENT_PRODUCT, JASAIN_BRAND } from './config/products.js';

const adminTabs = [
  ['dashboard', '대시보드', LayoutDashboard],
  ['accounts', '계정 관리', Users],
  ['generate', '주제/콘텐츠 생성', Wand2],
  ['products', '상품 추천 결과', Boxes],
  ['queue', '업로드 큐', ListChecks],
  ['analytics', '애널리틱스', BarChart3],
  ['settings', '설정', Settings],
  ['admin-users', '고객/권한 관리', ShieldCheck],
  ['admin-announcements', '공지 관리', Megaphone],
];

const userTabs = [
  ['dashboard', '대시보드', LayoutDashboard],
  ['accounts', '계정 관리', Users],
  ['generate', '주제/콘텐츠 생성', Wand2],
  ['products', '상품 추천 결과', Boxes],
  ['queue', '업로드 큐', ListChecks],
  ['analytics', '애널리틱스', BarChart3],
  ['settings', '설정', Settings],
];

const pages = {
  dashboard: DashboardPage,
  accounts: AccountListPage,
  generate: GeneratePage,
  products: ProductResultPage,
  queue: QueuePage,
  analytics: AnalyticsPage,
  settings: SettingsPage,
  'admin-users': AdminUsersPage,
  'admin-announcements': AdminAnnouncementsPage,
};

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountSettingsOpenId, setAccountSettingsOpenId] = useState('');
  const [currentUser, setCurrentUser] = useState(null); // { type, email, maxAccounts? }
  const [checkingAuth, setCheckingAuth] = useState(true);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0];
  const isAdmin = currentUser?.type === 'admin';
  const tabs = isAdmin ? adminTabs : userTabs;

  const loadAccounts = async () => {
    const rows = await api.get('/api/accounts');
    setAccounts(rows);
    if (!selectedAccountId && rows[0]) setSelectedAccountId(rows[0].id);
  };

  useEffect(() => {
    api.get('/api/auth/me')
      .then((result) => {
        if (result.type === 'admin') {
          setCurrentUser({ type: 'admin', email: result.admin?.email });
          return loadAccounts();
        }
        if (result.type === 'user') {
          setCurrentUser({
            type: 'user',
            email: result.user?.email,
            maxAccounts: result.user?.maxAccounts,
            products: result.user?.products || []
          });
          return loadAccounts();
        }
        if (result.devBypass === true) {
          setCurrentUser({ type: 'admin', email: 'dev-local' });
          return loadAccounts();
        }
        setAuthToken('');
        setCurrentUser(null);
        setAccounts([]);
        setSelectedAccountId('');
        return null;
      })
      .catch(() => {
        setAuthToken('');
        setCurrentUser(null);
        setAccounts([]);
        setSelectedAccountId('');
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  if (checkingAuth) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">인증 상태 확인 중</div>;
  }

  if (!currentUser && !getAuthToken()) {
    return (
      <ToastProvider>
        <LoginPage onLogin={(info) => {
          setCurrentUser({ type: info.type, email: info.email, maxAccounts: info.maxAccounts, products: info.products || [] });
          loadAccounts().catch(console.error);
        }} />
      </ToastProvider>
    );
  }

  // 고객(user)이면 별도 고객 앱 렌더링
  if (currentUser?.type === 'user') {
    const hasCujasa = (currentUser.products || []).some((product) => product.productId === CURRENT_PRODUCT.id && product.status !== 'suspended');
    if (!hasCujasa) {
      return (
        <ToastProvider>
          <ProductAccessBlocked currentUser={currentUser} onLogout={() => { setAuthToken(''); setCurrentUser(null); }} />
        </ToastProvider>
      );
    }
    return (
      <ToastProvider>
        <CustomerApp
          accounts={accounts}
          currentUser={currentUser}
          reloadAccounts={loadAccounts}
          onLogout={() => { setAuthToken(''); setCurrentUser(null); }}
        />
      </ToastProvider>
    );
  }

  const Page = pages[page] || DashboardPage;
  const openAccountSettings = (accountId) => {
    setSelectedAccountId(accountId);
    setAccountSettingsOpenId(accountId);
    setPage('accounts');
  };
  const openAccountQueue = (accountId) => {
    setSelectedAccountId(accountId);
    setPage('queue');
  };

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white p-4 md:block">
          <div className="px-2">
            <div className="text-lg font-bold">{JASAIN_BRAND.name}</div>
            <div className="mt-1 text-sm text-slate-500">{CURRENT_PRODUCT.name} · {CURRENT_PRODUCT.supportLabel}</div>
            {!isAdmin && currentUser?.maxAccounts && (
              <div className="mt-1 text-xs text-slate-400">계정 {accounts.length}/{currentUser.maxAccounts}</div>
            )}
          </div>
          <nav className="mt-6 grid gap-1">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setPage(key)}
                className={`flex items-center gap-3 rounded px-3 py-2 text-left text-sm ${page === key ? 'bg-coupang text-white' : 'hover:bg-panel'} ${key === 'admin-users' ? 'mt-2 border-t border-line pt-3' : ''}`}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="md:pl-64">
          <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-4 backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-xl font-semibold">{tabs.find(([key]) => key === page)?.[1]}</h1>
                <p className="text-sm text-slate-500">
                  {currentUser?.email} · {CURRENT_PRODUCT.name} · {isAdmin ? '관리자' : `계정 ${accounts.length}/${currentUser?.maxAccounts ?? 2}`}
                </p>
              </div>
              <select className="rounded border border-line px-3 py-2 text-sm" value={selectedAccount?.id || ''} onChange={(e) => setSelectedAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button onClick={() => { setAuthToken(''); setCurrentUser(null); }} className="rounded border border-line px-3 py-2 text-sm">로그아웃</button>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto md:hidden">
              {tabs.map(([key, label]) => <button key={key} onClick={() => setPage(key)} className={`shrink-0 rounded px-3 py-2 text-sm ${page === key ? 'bg-coupang text-white' : 'bg-panel'}`}>{label}</button>)}
            </div>
          </header>
          <section className="p-5">
            <Page
              accounts={accounts}
              selectedAccount={selectedAccount}
              reloadAccounts={loadAccounts}
              setSelectedAccountId={setSelectedAccountId}
              currentUser={currentUser}
              setPage={setPage}
              openAccountSettings={openAccountSettings}
              openAccountQueue={openAccountQueue}
              accountSettingsOpenId={accountSettingsOpenId}
              onAccountSettingsOpened={() => setAccountSettingsOpenId('')}
            />
          </section>
        </main>
      </div>
    </ToastProvider>
  );
}

function ProductAccessBlocked({ currentUser, onLogout }) {
  return (
    <div className="grid min-h-screen place-items-center bg-panel px-5">
      <div className="w-full max-w-sm rounded border border-line bg-white p-6">
        <div className="text-lg font-bold">{JASAIN_BRAND.name}</div>
        <div className="mt-1 text-sm text-slate-500">{currentUser.email}</div>
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          이 계정에는 {CURRENT_PRODUCT.name} 제품 권한이 없습니다. 관리자에게 제품 권한 추가를 요청해주세요.
        </div>
        <button onClick={onLogout} className="mt-5 w-full rounded border border-line px-4 py-2 text-sm font-medium">
          로그아웃
        </button>
      </div>
    </div>
  );
}
