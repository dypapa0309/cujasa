import { Component, useEffect, useState } from 'react';
import { ToastProvider } from './lib/toast.jsx';
import { LayoutDashboard, Settings, Users, Wand2, Boxes, ListChecks, BarChart3, ShieldCheck, Megaphone, ClipboardCheck, DatabaseZap, Sparkles } from 'lucide-react';
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
import AdminSetupPage from './pages/AdminSetupPage.jsx';
import AdminPolibotKnowledgePage from './pages/AdminPolibotKnowledgePage.jsx';
import AdminTrendReferencePage from './pages/AdminTrendReferencePage.jsx';
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
  ['admin-trend-references', '콘텐츠 패턴', Sparkles],
  ['admin-polibot-knowledge', 'POLIBOT 자료', DatabaseZap],
  ['admin-setup', '셋업 대기', ClipboardCheck],
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
  'admin-trend-references': AdminTrendReferencePage,
  'admin-polibot-knowledge': AdminPolibotKnowledgePage,
  'admin-setup': AdminSetupPage,
  'admin-announcements': AdminAnnouncementsPage,
};
const accountScopedPages = new Set(['accounts', 'generate', 'products', 'queue', 'analytics', 'settings']);

function normalizeProducts(products) {
  return Array.isArray(products) ? products : [];
}

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[APP RENDER ERROR]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-5 text-white">
        <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <div className="text-lg font-black">화면을 불러오지 못했습니다</div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">로컬 화면 렌더링 중 오류가 발생했습니다. 아래 내용을 확인한 뒤 새로고침해주세요.</p>
          <pre className="mt-4 max-h-52 overflow-auto rounded-2xl bg-black/35 p-4 text-xs leading-relaxed text-rose-100">
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">
            새로고침
          </button>
        </div>
      </div>
    );
  }
}

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
    if (!rows.some((row) => row.id === selectedAccountId)) setSelectedAccountId(rows[0]?.id || '');
  };

  const applyAuthResult = (result) => {
        if (result.type === 'admin') {
          setCurrentUser({ type: 'admin', email: result.admin?.email });
          return loadAccounts();
        }
        if (result.type === 'user') {
          setCurrentUser({
            type: 'user',
            email: result.user?.email,
            username: result.user?.username,
            maxAccounts: result.user?.maxAccounts,
            products: normalizeProducts(result.user?.products),
            billing: result.user?.billing || null
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
  };

  const reloadCurrentUser = async () => {
    const result = await api.get('/api/auth/me');
    return applyAuthResult(result);
  };

  useEffect(() => {
    reloadCurrentUser()
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
        <GlobalApiLoadingBar />
        <LoginPage onLogin={(info) => {
          setCurrentUser({ type: info.type, email: info.email, username: info.username, maxAccounts: info.maxAccounts, products: normalizeProducts(info.products), billing: info.billing || null });
          loadAccounts().catch(console.error);
        }} />
      </ToastProvider>
    );
  }

  // 고객(user)이면 솔루션 허브가 포함된 별도 고객 앱 렌더링
  if (currentUser?.type === 'user') {
    return (
      <ToastProvider>
        <GlobalApiLoadingBar />
        <CustomerApp
          accounts={accounts}
          currentUser={{ ...currentUser, products: normalizeProducts(currentUser.products) }}
          reloadAccounts={loadAccounts}
          reloadCurrentUser={reloadCurrentUser}
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
  const showAccountSelector = accountScopedPages.has(page);

  return (
    <ToastProvider>
      <GlobalApiLoadingBar />
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white p-4 md:block">
          <div className="px-2">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white">
                <img src="/jasain_logo.png" alt="JASAIN" className="h-full w-full object-cover" />
              </div>
              <div>
                <div className="text-lg font-black text-slate-950">{JASAIN_BRAND.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{isAdmin ? 'Admin workspace' : CURRENT_PRODUCT.supportLabel}</div>
              </div>
            </div>
            {!isAdmin && currentUser?.maxAccounts && (
              <div className="mt-3 text-xs text-slate-500">계정 {accounts.length}/{currentUser.maxAccounts}</div>
            )}
          </div>
          <nav className="mt-6 grid gap-1">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setPage(key)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold ${page === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'} ${key === 'admin-users' ? 'mt-2 border-t border-slate-200 pt-3' : ''}`}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="md:pl-64">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-xl font-black text-slate-950">{tabs.find(([key]) => key === page)?.[1]}</h1>
                <p className="text-sm text-slate-500">
                  {currentUser?.email} · {CURRENT_PRODUCT.name} · {isAdmin ? '관리자' : `계정 ${accounts.length}/${currentUser?.maxAccounts ?? 2}`}
                </p>
              </div>
              {showAccountSelector && (
                <AccountSearchSelect
                  accounts={accounts}
                  value={selectedAccount?.id || ''}
                  onChange={setSelectedAccountId}
                />
              )}
              <button onClick={() => { setAuthToken(''); setCurrentUser(null); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-950">로그아웃</button>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto md:hidden">
              {tabs.map(([key, label]) => <button key={key} onClick={() => setPage(key)} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${page === key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500'}`}>{label}</button>)}
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

function GlobalApiLoadingBar() {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (event) => setLoading(Boolean(event.detail?.loading));
    window.addEventListener('jasain-api-loading', handler);
    return () => window.removeEventListener('jasain-api-loading', handler);
  }, []);

  return (
    <div className={`fixed inset-x-0 top-0 z-[9999] h-1 overflow-hidden bg-transparent transition-opacity duration-200 ${loading ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      <div className="h-full w-full bg-gradient-to-r from-zinc-950 via-zinc-300 to-zinc-950 shadow-[0_0_18px_rgba(255,255,255,0.35)]" />
    </div>
  );
}

function accountSearchText(account = {}) {
  return [
    account.name,
    account.account_handle,
    account.owner_label,
    account.owner?.buyerName,
    account.owner?.username,
    account.owner?.email
  ].filter(Boolean).join(' ').toLowerCase();
}

function AccountSearchSelect({ accounts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = accounts.find((account) => account.id === value);
  const filtered = accounts
    .filter((account) => !query.trim() || accountSearchText(account).includes(query.trim().toLowerCase()))
    .slice(0, 12);

  return (
    <div className="relative min-w-[240px]">
      <input
        className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/25"
        value={open ? query : (selected ? `${selected.name}${selected.owner_label ? ` · ${selected.owner_label}` : ''}` : '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        placeholder="계정/고객/아이디 검색"
      />
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border border-white/10 bg-[#191919] shadow-2xl shadow-black/50">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-zinc-500">검색 결과 없음</div>
          ) : filtered.map((account) => (
            <button
              key={account.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(account.id); setOpen(false); setQuery(''); }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/5 ${account.id === value ? 'bg-white/10 text-white' : 'text-zinc-300'}`}
            >
              <div className="font-semibold">{account.name}</div>
              <div className="text-xs text-zinc-600">
                {[account.account_handle, account.owner_label || '고객 미할당'].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(false)} className="block w-full border-t border-white/10 px-3 py-2 text-left text-xs text-zinc-500">
            닫기
          </button>
        </div>
      )}
    </div>
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
