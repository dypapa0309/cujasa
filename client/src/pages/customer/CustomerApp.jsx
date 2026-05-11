import { useEffect, useRef, useState } from 'react';
import { Beaker, CreditCard, Home, FileText, Settings, Plus, X, AlertCircle, CheckCircle2, PlayCircle, Search, Sparkles } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';
import CustomerHomePage from './CustomerHomePage.jsx';
import CustomerPostsPage from './CustomerPostsPage.jsx';
import CustomerSettingsPage from './CustomerSettingsPage.jsx';
import CustomerBillingPage from './CustomerBillingPage.jsx';
import CustomerRunPage from './CustomerRunPage.jsx';
import CustomerBetaPage from './CustomerBetaPage.jsx';
import { CURRENT_PRODUCT, JASAIN_BRAND, productById } from '../../config/products.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';

const baseTabs = [
  ['home', '홈', Home],
  ['run', '자동화 실행', PlayCircle],
  ['posts', '포스팅 현황', FileText],
  ['billing', '결제', CreditCard],
  ['settings', '설정', Settings],
];

const basePages = {
  home: CustomerHomePage,
  run: CustomerRunPage,
  posts: CustomerPostsPage,
  billing: CustomerBillingPage,
  settings: CustomerSettingsPage,
};

function pipelineHasReservations(result = {}) {
  const queuedCount = result?.queuedCount ?? result?.steps?.queued;
  return (result.ok === true || result.status === 'ok') && Number(queuedCount || 0) > 0;
}

function todayKstKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export default function CustomerApp({ accounts, currentUser, reloadAccounts, reloadCurrentUser, onLogout }) {
  const toast = useToast();
  const routingReadyRef = useRef(false);
  const useWorkspaceShell = true;
  const searchParams = new URLSearchParams(window.location.search);
  const productParam = productById(searchParams.get('product'))?.id;
  const isProductStartRequest = searchParams.get('mode') === 'register' && productParam && productParam !== CURRENT_PRODUCT.id;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const requestedTab = hashParams.get('tab');
  const shouldUseBetaWorkspace = true;
  const userProducts = Array.isArray(currentUser?.products) ? currentUser.products : [];
  const activeProducts = userProducts
    .filter((product) => product.status !== 'suspended')
    .map((grant) => productById(grant.productId) || {
      id: grant.productId,
      name: grant.name || grant.productId,
      description: grant.description || '',
      supportLabel: grant.description || ''
    })
    .filter((product) => product?.id);
  const defaultProductId = isProductStartRequest
    ? productParam
    : useWorkspaceShell && activeProducts.some((product) => product.id === CURRENT_PRODUCT.id)
    ? CURRENT_PRODUCT.id
    : activeProducts.some((product) => product.id === productParam)
    ? productParam
    : activeProducts.some((product) => product.id === CURRENT_PRODUCT.id)
      ? CURRENT_PRODUCT.id
      : activeProducts[0]?.id || CURRENT_PRODUCT.id;
  const [selectedProductId, setSelectedProductId] = useState(defaultProductId);
  const [tab, setTab] = useState('beta');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: '', account_handle: '' });
  const [announcement, setAnnouncement] = useState(null);
  const [trialStatus, setTrialStatus] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [requestingSetup, setRequestingSetup] = useState(false);

  const maxAccounts = currentUser?.maxAccounts ?? 2;
  const account = accounts[selectedIdx] ?? accounts[0];
  const canAdd = accounts.length < maxAccounts;
  const displayLogin = currentUser.username || currentUser.email;
  const selectedProduct = productById(selectedProductId) || activeProducts.find((product) => product.id === selectedProductId) || CURRENT_PRODUCT;
  const hasCujasa = activeProducts.some((product) => product.id === CURRENT_PRODUCT.id);
  const tabs = useWorkspaceShell ? [...baseTabs, ['beta', '워크스페이스', Beaker]] : baseTabs;
  const pages = useWorkspaceShell ? { ...basePages, beta: CustomerBetaPage } : basePages;
  const Page = pages[tab] || pages.home;
  const isBetaTab = tab === 'beta';

  const productSearch = (productId = selectedProductId) => {
    const params = new URLSearchParams(window.location.search);
    if (productId === CURRENT_PRODUCT.id) {
      params.delete('product');
      params.delete('mode');
    } else {
      params.set('product', productId);
    }
    const nextSearch = params.toString();
    return nextSearch ? `?${nextSearch}` : '';
  };

  useEffect(() => {
    if (activeProducts.length === 0) return;
    if (shouldUseBetaWorkspace) return;
    if (useWorkspaceShell && hasCujasa && selectedProductId !== CURRENT_PRODUCT.id) {
      setSelectedProductId(CURRENT_PRODUCT.id);
      return;
    }
    if (!activeProducts.some((product) => product.id === selectedProductId)) {
      setSelectedProductId(activeProducts[0].id);
    }
  }, [userProducts, useWorkspaceShell, hasCujasa, selectedProductId, shouldUseBetaWorkspace]);

  useEffect(() => {
    if (!shouldUseBetaWorkspace) return;
    if (tab !== 'beta') setTab('beta');
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('tab') === 'beta') return;
    const accountId = params.get('account') || account?.id || accounts[0]?.id || '';
    const nextHash = `#tab=beta${accountId ? `&account=${encodeURIComponent(accountId)}` : ''}`;
    window.history.replaceState(
      { jasainProduct: productParam || selectedProductId, tab: 'beta', accountId },
      '',
      `${window.location.pathname}${window.location.search}${nextHash}`
    );
  }, [shouldUseBetaWorkspace, tab, account?.id, accounts, productParam, selectedProductId]);

  useEffect(() => {
    if (selectedProductId !== CURRENT_PRODUCT.id) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('product') && !params.has('mode')) return;
    window.history.replaceState(
      { jasainProduct: CURRENT_PRODUCT.id },
      '',
      `${window.location.pathname}${productSearch(CURRENT_PRODUCT.id)}${window.location.hash}`
    );
  }, [selectedProductId]);

  const changeProduct = (nextProductId) => {
    if (guardDuringPipeline()) return;
    const nextTab = useWorkspaceShell ? 'beta' : 'home';
    setSelectedProductId(nextProductId);
    setTab(nextTab);
    window.history.replaceState(
      { jasainProduct: nextProductId, tab: nextTab },
      '',
      `${window.location.pathname}${productSearch(nextProductId)}${nextTab === 'beta' ? '#tab=beta' : nextProductId === CURRENT_PRODUCT.id && accounts[0]?.id ? `#tab=home&account=${encodeURIComponent(accounts[0].id)}` : ''}`
    );
  };

  const header = (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-black text-lg text-coupang tracking-tight">{JASAIN_BRAND.name}</div>
          <div className="truncate text-xs text-gray-400 mt-0.5">{selectedProduct.name} · {displayLogin}</div>
        </div>
        <div className="flex items-center gap-2">
          {activeProducts.length > 1 && (
            <SearchableSelect
              value={selectedProductId}
              onChange={changeProduct}
              options={activeProducts.map((product) => ({
                value: product.id,
                label: product.name,
                searchText: [product.name, product.supportLabel, product.description].filter(Boolean).join(' ')
              }))}
              placeholder="솔루션"
              searchPlaceholder="솔루션 검색"
              variant="compact"
              className="w-36 text-xs font-bold"
            />
          )}
          <button onClick={() => { if (!guardDuringPipeline()) onLogout(); }} className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );

  const parseRoute = () => {
    const raw = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw);
    const nextTab = pages[params.get('tab')] ? params.get('tab') : 'home';
    const accountId = params.get('account');
    return { tab: nextTab, accountId };
  };

  const routeUrl = (nextTab, accountId) => {
    const params = new URLSearchParams();
    params.set('tab', nextTab);
    if (accountId) params.set('account', accountId);
    return `${window.location.pathname}${productSearch()}#${params.toString()}`;
  };

  const applyRoute = () => {
    const next = shouldUseBetaWorkspace ? { ...parseRoute(), tab: 'beta' } : parseRoute();
    setTab(next.tab);
    if (next.accountId) {
      const nextIndex = accounts.findIndex((item) => item.id === next.accountId);
      if (nextIndex >= 0) setSelectedIdx(nextIndex);
    }
  };

  const writeRoute = (nextTab = tab, nextIndex = selectedIdx, { replace = false } = {}) => {
    const accountId = accounts[nextIndex]?.id || accounts[0]?.id || '';
    const nextUrl = routeUrl(nextTab, accountId);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) return;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ cujasa: true, tab: nextTab, accountId }, '', nextUrl);
  };

  const navigateTab = (nextTab, options) => {
    setTab(nextTab);
    writeRoute(nextTab, selectedIdx, options);
  };

  const navigateAccount = (nextIndex, options) => {
    setSelectedIdx(nextIndex);
    writeRoute(tab, nextIndex, options);
  };

  const guardDuringPipeline = () => {
    if (!pipelineRunning) return false;
    toast('예약 작업 실행 중입니다. 완료될 때까지 잠시만 기다려주세요.', 'info');
    return true;
  };
  const announcementDismissKey = (id, date = todayKstKey()) => `announcement:${currentUser?.email || currentUser?.username || 'user'}:${id}:${date}:dismissed`;

  useEffect(() => {
    let cancelled = false;
    api.get('/api/announcements/active')
      .then((row) => {
        if (cancelled || !row?.id) return;
        if (localStorage.getItem(announcementDismissKey(row.id)) === '1') return;
        setAnnouncement(row);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUser?.email, currentUser?.username]);

  const loadTrialStatus = async () => {
    try {
      setTrialStatus(await api.get('/api/me/trial-status'));
    } catch {
      setTrialStatus(null);
    }
  };

  const loadSetupStatus = async () => {
    try {
      setSetupStatus(await api.get('/api/me/setup-status'));
    } catch {
      setSetupStatus(null);
    }
  };

  const requestSetup = async () => {
    setRequestingSetup(true);
    try {
      const items = [...(setupStatus?.blocking || []), ...(setupStatus?.warnings || [])].map((entry) => entry.title).filter(Boolean);
      const result = await api.post('/api/me/setup-request', {
        accountId: account?.id || null,
        message: items.length ? `부족 항목: ${items.join(', ')}` : ''
      });
      await loadSetupStatus();
      toast(result.alreadyExists ? '이미 접수된 셋업 요청이 있어요. 관리자가 확인 중입니다.' : '관리자에게 셋업 요청을 보냈어요.', 'success');
    } catch (err) {
      toast(err.message || '셋업 요청을 보내지 못했어요.', 'error');
    } finally {
      setRequestingSetup(false);
    }
  };

  useEffect(() => {
    loadTrialStatus();
    loadSetupStatus();
  }, [currentUser?.email]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const threads = params.get('threads');
    if (!threads) return;
    const accountId = params.get('accountId');
    if (accountId) {
      const nextIndex = accounts.findIndex((item) => item.id === accountId);
      if (nextIndex >= 0) setSelectedIdx(nextIndex);
    }
    setTab('settings');
    if (threads === 'connected') {
      toast('Threads 연결이 완료됐습니다.', 'success');
      if (accountId) sessionStorage.removeItem(`cujasa:threadsOAuthError:${accountId}`);
    }
    if (threads === 'error') {
      const message = params.get('message') || 'Threads 연결에 실패했습니다.';
      const code = params.get('code') || '';
      toast(message, 'error');
      if (accountId) {
        sessionStorage.setItem(`cujasa:threadsOAuthError:${accountId}`, JSON.stringify({
          message,
          code,
          at: new Date().toISOString()
        }));
      }
    }
    if (threads === 'connected') {
      reloadAccounts?.();
      loadSetupStatus();
    }
    params.delete('threads');
    params.delete('accountId');
    params.delete('message');
    params.delete('code');
    const nextSearch = params.toString();
    const nextAccountId = accountId || account?.id || accounts[0]?.id || '';
    window.history.replaceState(
      { cujasa: true, tab: 'settings', accountId: nextAccountId },
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}#tab=settings${nextAccountId ? `&account=${encodeURIComponent(nextAccountId)}` : ''}`
    );
  }, [accounts, toast]);

  useEffect(() => {
    if (accounts.length === 0) return undefined;
    if (!routingReadyRef.current) {
      routingReadyRef.current = true;
      if (window.location.hash) {
        applyRoute();
      } else {
        writeRoute(tab, selectedIdx, { replace: true });
      }
    }

    const handlePopState = () => {
      if (pipelineRunning) {
        toast('예약 작업 실행 중입니다. 완료될 때까지 잠시만 기다려주세요.', 'info');
        writeRoute(tab, selectedIdx, { replace: true });
        return;
      }
      applyRoute();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [accounts, pipelineRunning, tab, selectedIdx, toast]);

  const closeAnnouncement = () => {
    setAnnouncement(null);
  };

  const hideAnnouncementToday = () => {
    if (announcement?.id) localStorage.setItem(announcementDismissKey(announcement.id), '1');
    setAnnouncement(null);
  };

  useEffect(() => {
    if (!pipelineRunning) return undefined;

    const preventLeave = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', preventLeave);
    return () => window.removeEventListener('beforeunload', preventLeave);
  }, [pipelineRunning]);

  useEffect(() => {
    if (!pipelineRunning || !account?.id) return undefined;
    let cancelled = false;

    const loadProgress = async () => {
      try {
        const payload = await api.get(`/api/accounts/${account.id}/pipeline-run`);
        if (cancelled || !payload?.run) return;
        setPipelineProgress(payload.run.progress);
        if (payload.run.status === 'completed' || payload.run.status === 'skipped') {
          setPipelineResult(payload.run.result);
          reloadAccounts?.();
          loadTrialStatus();
          loadSetupStatus();
          navigateTab(pipelineHasReservations(payload.run.result) ? 'posts' : 'run');
          if (payload.run.status === 'skipped') {
            toast(payload.run.result?.message || '오늘은 수익화 가능한 상품 링크 후보가 없어 업로드하지 않았습니다.', 'info');
          }
          setPipelineRunning(false);
        } else if (payload.run.status === 'failed') {
          const result = payload.run.result || {};
          const nextResult = {
            ok: false,
            status: 'error',
            code: result.code || 'PIPELINE_FAILED',
            stage: result.stage || 'pipeline',
            message: payload.run.errorMessage || result.message || result.error || '예약 작업 중 오류가 발생했습니다.',
            blocking: result.blocking || []
          };
          setPipelineResult(nextResult);
          reloadAccounts?.();
          loadTrialStatus();
          loadSetupStatus();
          navigateTab('run');
          toast(nextResult.message, 'error');
          setPipelineRunning(false);
        }
      } catch {
        // Progress polling should never interrupt the actual pipeline request.
      }
    };

    loadProgress();
    const timer = window.setInterval(loadProgress, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pipelineRunning, account?.id, toast]);

  const handlePipelineRunningChange = (isRunning, progress = null) => {
    setPipelineRunning(isRunning);
    if (isRunning) {
      setPipelineProgress(progress || {
        percent: 0,
        stage: 'starting',
        label: '예약 작업을 준비하고 있습니다'
      });
    } else {
      setPipelineProgress(null);
    }
  };

  const addAccount = async (e) => {
    e.preventDefault();
    if (guardDuringPipeline()) return;
    if (!newAccount.name.trim()) return;
    setAdding(true);
    try {
      await api.post('/api/accounts', {
        name: newAccount.name.trim(),
        account_handle: newAccount.account_handle.trim(),
        platform: 'threads',
        project_id: '00000000-0000-0000-0000-000000000001',
      });
      await reloadAccounts();
      await loadSetupStatus();
      setNewAccount({ name: '', account_handle: '' });
      setShowAddForm(false);
      setSelectedIdx(accounts.length); // 새로 만든 계정 선택
      toast('계정이 추가됐습니다.', 'success');
    } catch (e) {
      toast(e?.message || '계정 추가에 실패했습니다.', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (activeProducts.length === 0 && !shouldUseBetaWorkspace) {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <main className="mx-auto grid max-w-2xl gap-4 px-5 py-10">
          <ProductEmptyState onLogout={onLogout} />
        </main>
      </div>
    );
  }

  if (selectedProductId !== CURRENT_PRODUCT.id && !shouldUseBetaWorkspace) {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <main className="mx-auto max-w-2xl px-5 py-6 pb-28">
          <SolutionHome product={selectedProduct} />
        </main>
      </div>
    );
  }

  if (!hasCujasa && !shouldUseBetaWorkspace) {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <main className="mx-auto grid max-w-2xl gap-4 px-5 py-10">
          <ProductEmptyState onLogout={onLogout} />
        </main>
      </div>
    );
  }

  return (
    <div className={isBetaTab ? 'min-h-screen bg-[#111111]' : 'min-h-screen bg-gray-50'}>
      {!isBetaTab && header}

      <main className={isBetaTab ? 'mx-auto min-h-screen max-w-none p-0' : 'max-w-2xl mx-auto px-5 py-6 pb-28'}>
        {isBetaTab ? (
          <Page
            account={account}
            accounts={accounts}
            currentUser={currentUser}
            onLogout={onLogout}
            trialStatus={trialStatus}
            reloadTrialStatus={loadTrialStatus}
            setupStatus={setupStatus}
            reloadSetupStatus={loadSetupStatus}
            setTab={navigateTab}
            reloadAccounts={reloadAccounts}
            reloadCurrentUser={reloadCurrentUser}
            onSelectAccount={navigateAccount}
            pipelineResult={pipelineResult}
            onPipelineDone={(result) => { setPipelineResult(result); }}
            onPipelineRunningChange={handlePipelineRunningChange}
          />
        ) : accounts.length === 0 ? (
          <>
            <WaitingScreen
              setupStatus={setupStatus}
              onGoSettings={() => navigateTab('settings')}
              onGoBilling={() => navigateTab('billing')}
              onAddAccount={() => setShowAddForm(true)}
              onRequestSetup={requestSetup}
              requestingSetup={requestingSetup}
            />
            {showAddForm && (
              <form onSubmit={addAccount} className="bg-white border border-gray-200 rounded-2xl p-5 mb-5 grid gap-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">새 계정 추가</span>
                  <button type="button" onClick={() => setShowAddForm(false)}><X size={16} className="text-gray-400" /></button>
                </div>
                <input
                  type="text"
                  placeholder="계정 이름 (예: 자취 꿀템)"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount((p) => ({ ...p, name: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-coupang"
                  required
                />
                <input
                  type="text"
                  placeholder="Threads 핸들 (예: @myhandle)"
                  value={newAccount.account_handle}
                  onChange={(e) => setNewAccount((p) => ({ ...p, account_handle: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-coupang"
                />
                <button
                  type="submit"
                  disabled={adding || !newAccount.name.trim()}
                  className="bg-coupang text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50"
                >
                  {adding ? '추가 중...' : '추가하기'}
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <SetupStatusCard setupStatus={setupStatus} setTab={navigateTab} onRequestSetup={requestSetup} requestingSetup={requestingSetup} />

            {/* 계정 탭 */}
            <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
              {accounts.map((acc, i) => (
                <button
                  key={acc.id}
                  onClick={() => { if (!guardDuringPipeline()) navigateAccount(i); }}
                  className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-colors
                    ${selectedIdx === i ? 'bg-coupang text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-coupang hover:text-coupang'}`}
                >
                  <span>{acc.name}</span>
                  <span className={`ml-2 inline-block h-2 w-2 rounded-full align-middle ${acc.has_threads_access_token ? 'bg-emerald-300' : 'bg-rose-300'}`} />
                </button>
              ))}
              {canAdd && (
                <button
                  onClick={() => { if (!guardDuringPipeline()) setShowAddForm(true); }}
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border border-dashed border-gray-300 text-gray-400 hover:border-coupang hover:text-coupang transition-colors"
                >
                  <Plus size={14} />
                  계정 추가
                </button>
              )}
              {!canAdd && (
                <span className="flex-shrink-0 text-xs text-gray-400 px-2">{accounts.length}/{maxAccounts} 한도</span>
              )}
            </div>

            {/* 계정 추가 폼 */}
            {showAddForm && (
              <form onSubmit={addAccount} className="bg-white border border-gray-200 rounded-2xl p-5 mb-5 grid gap-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">새 계정 추가</span>
                  <button type="button" onClick={() => setShowAddForm(false)}><X size={16} className="text-gray-400" /></button>
                </div>
                <input
                  type="text"
                  placeholder="계정 이름 (예: 자취 꿀템)"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount((p) => ({ ...p, name: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-coupang"
                  required
                />
                <input
                  type="text"
                  placeholder="Threads 핸들 (예: @myhandle)"
                  value={newAccount.account_handle}
                  onChange={(e) => setNewAccount((p) => ({ ...p, account_handle: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-coupang"
                />
                <button
                  type="submit"
                  disabled={adding || !newAccount.name.trim()}
                  className="bg-coupang text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50"
                >
                  {adding ? '추가 중...' : '추가하기'}
                </button>
              </form>
            )}

            <Page
              account={account}
              accounts={accounts}
              currentUser={currentUser}
              trialStatus={trialStatus}
              reloadTrialStatus={loadTrialStatus}
              setupStatus={setupStatus}
              reloadSetupStatus={loadSetupStatus}
              setTab={navigateTab}
              reloadAccounts={reloadAccounts}
              pipelineResult={pipelineResult}
              onPipelineDone={(result) => { setPipelineResult(result); navigateTab(pipelineHasReservations(result) ? 'posts' : 'run'); }}
              onPipelineRunningChange={handlePipelineRunningChange}
            />
          </>
        )}
      </main>

      {!isBetaTab && (
        <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 safe-area-bottom">
          <div className="max-w-2xl mx-auto grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => { if (!guardDuringPipeline()) navigateTab(key); }}
                className={`flex flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors sm:text-xs
                  ${tab === key ? 'text-coupang' : 'text-gray-400 hover:text-gray-600'}`}>
                <Icon size={20} strokeWidth={tab === key ? 2.5 : 1.8} />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
      {announcement && (
        <AnnouncementModal announcement={announcement} onClose={closeAnnouncement} onHideToday={hideAnnouncementToday} dark={isBetaTab} />
      )}
      {pipelineRunning && <PipelineOverlay progress={pipelineProgress} dark={isBetaTab} />}
    </div>
  );
}

function ProductEmptyState({ onLogout }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-coupang">
        <Sparkles size={22} />
      </div>
      <div className="mt-4 text-lg font-black text-gray-900">사용 가능한 솔루션이 없습니다</div>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">
        회원가입 또는 결제가 완료된 솔루션이 이 계정에 연결되면 이곳에서 선택해 사용할 수 있습니다.
      </p>
      <button type="button" onClick={onLogout} className="mt-5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600">
        로그아웃
      </button>
    </div>
  );
}

function SolutionHome({ product }) {
  if (product.id === 'dexor') {
    return (
      <div className="grid gap-5">
        <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-slate-900 p-6 text-white">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-blue-100">
            <Search size={14} />
            블로그 선정 자동화
          </div>
          <h1 className="mt-5 text-2xl font-black leading-tight">DEXOR 분석을 시작할 준비가 됐습니다</h1>
          <p className="mt-3 text-sm leading-relaxed text-blue-100">
            URL과 엑셀 기반 블로그 후보를 분석해 S/A 후보 중심으로 선정 업무를 줄이는 화면입니다.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['1', 'URL 업로드', '블로그 URL 또는 엑셀을 준비합니다.'],
            ['2', '등급 분석', '활동성, 광고성, 반응성을 기준으로 분류합니다.'],
            ['3', '후보 다운로드', '선정 후보를 정리해 내려받습니다.']
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-2xl border border-gray-100 bg-white p-5">
              <div className="text-3xl font-black text-blue-100">{step}</div>
              <div className="mt-3 font-black text-gray-900">{title}</div>
              <div className="mt-1 text-xs leading-relaxed text-gray-500">{body}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm leading-relaxed text-blue-700">
          분석 업로드 기능은 JASAIN 통합 화면에 순차적으로 연결됩니다. 지금은 제품 권한과 진입 흐름이 준비된 상태입니다.
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-slate-900 p-6 text-white">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-teal-100">
          <Sparkles size={14} />
          추천 캠페인
        </div>
        <h1 className="mt-5 text-2xl font-black leading-tight">SPREAD 추천 캠페인을 준비 중입니다</h1>
        <p className="mt-3 text-sm leading-relaxed text-teal-100">
          브랜드 캠페인, 신청자 선정, 제출물 검수까지 한 흐름으로 운영하는 솔루션입니다.
        </p>
      </div>
      <div className="grid gap-3">
        {[
          ['신규 캠페인 추천', '목표 채널과 상품 유형에 맞춰 캠페인 틀을 제안합니다.'],
          ['참여자 선정', '신청자 정보와 채널 지표를 비교해 후보를 정리합니다.'],
          ['제출물 검수', 'URL, 필수 키워드, 금지 표현을 먼저 확인합니다.']
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-gray-100 bg-white p-5">
            <div className="font-black text-gray-900">{title}</div>
            <div className="mt-1 text-sm leading-relaxed text-gray-500">{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnnouncementModal({ announcement, onClose, onHideToday, dark = false }) {
  if (dark) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-5 backdrop-blur-md">
        <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#191919] shadow-2xl shadow-black/60">
          <div className="shrink-0 border-b border-white/10 px-6 py-5">
            <div className="text-xs font-black uppercase tracking-wide text-zinc-500">공지사항</div>
            <h2 className="mt-2 text-xl font-black text-zinc-100">{announcement.title}</h2>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-400">{announcement.message}</p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-white/10 bg-black/20 px-5 py-4">
            <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-zinc-300 hover:bg-white/10 hover:text-white">
              닫기
            </button>
            <button type="button" onClick={onHideToday} className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100">
              오늘 하루 보지 않기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 border-b border-gray-100 px-6 py-5">
          <div className="text-xs font-bold uppercase tracking-widest text-coupang">공지사항</div>
          <h2 className="mt-2 text-xl font-black text-gray-900">{announcement.title}</h2>
        </div>
        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">{announcement.message}</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-gray-100 bg-gray-50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-600">
            닫기
          </button>
          <button type="button" onClick={onHideToday} className="rounded-xl bg-coupang px-4 py-3 text-sm font-bold text-white">
            오늘 하루 보지 않기
          </button>
        </div>
      </div>
    </div>
  );
}

function PipelineOverlay({ progress, dark = false }) {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent ?? 0)));
  const label = progress?.label || '예약 작업을 준비하고 있습니다';

  if (dark) {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-black/55 px-5 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-[#191919] p-6 text-center shadow-2xl shadow-black/60">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-white" />
          <div className="text-lg font-black text-zinc-100">예약 작업 실행 중입니다</div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs font-black text-zinc-400">
              <span>{label}</span>
              <span>{Math.round(percent)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            중복 생성을 막기 위해 완료 전까지 화면 이동이 잠시 제한됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-white/80 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-blue-100 bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-coupang" />
        <div className="text-lg font-black text-gray-800">예약 작업 실행 중입니다</div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-blue-600">
            <span>{label}</span>
            <span>{Math.round(percent)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-blue-50">
            <div
              className="h-full rounded-full bg-coupang transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-gray-500">
          중복 생성을 막기 위해 완료 전까지 화면 이동이 잠시 제한됩니다.
        </p>
      </div>
    </div>
  );
}

function SetupStatusCard({ setupStatus, setTab, onRequestSetup, requestingSetup }) {
  if (!setupStatus || setupStatus.ready) return null;
  const items = [...(setupStatus.blocking || []), ...(setupStatus.warnings || [])].slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="font-black text-amber-900">셋업 확인이 필요합니다</div>
          <div className="mt-1 grid gap-1.5">
            {items.map((entry) => (
              <div key={`${entry.code}-${entry.accountId || 'all'}`} className="text-xs leading-relaxed text-amber-800">
                <span className="font-bold">{entry.title}</span>
                <span className="opacity-80"> · {entry.message}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setTab?.('settings')} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white">
              설정하러 가기
            </button>
            <button type="button" onClick={onRequestSetup} disabled={requestingSetup} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-700 disabled:opacity-60">
              {requestingSetup ? '요청 중...' : '관리자 셋업 요청'}
            </button>
            {items.some((entry) => entry.action === 'billing') && (
              <button type="button" onClick={() => setTab?.('billing')} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-700">
                결제 확인
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WaitingScreen({ setupStatus, onGoSettings, onGoBilling, onAddAccount, onRequestSetup, requestingSetup }) {
  const items = [...(setupStatus?.blocking || []), ...(setupStatus?.warnings || [])];
  const needsAccount = items.some((entry) => entry.code === 'account_required');
  return (
    <div className="grid gap-4 py-10">
      <div className="rounded-2xl border border-gray-100 bg-white p-6">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-coupang" />
          <h2 className="text-xl font-black text-gray-900">셋업 상태 확인</h2>
        </div>
        <p className="text-sm leading-relaxed text-gray-500">
          무료 체험은 고객님이 직접 설정을 완료하면 바로 사용할 수 있습니다. 아래 부족한 항목을 먼저 확인해주세요.
        </p>
      </div>
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
        <div className="font-black text-amber-900">부족한 항목</div>
        <div className="mt-3 grid gap-2">
          {items.length ? items.map((entry) => (
            <div key={`${entry.code}-${entry.accountId || 'all'}`} className="rounded-xl bg-white px-4 py-3 text-sm">
              <div className="font-bold text-gray-900">{entry.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-gray-500">{entry.message}</div>
            </div>
          )) : (
            <div className="rounded-xl bg-white px-4 py-3 text-sm text-gray-500">계정 정보를 불러오는 중입니다.</div>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={needsAccount ? onAddAccount : onGoSettings} className="flex-1 rounded-xl bg-coupang py-3 text-sm font-black text-white">
            {needsAccount ? '계정 추가하기' : '설정하러 가기'}
          </button>
          <button type="button" onClick={onRequestSetup} disabled={requestingSetup} className="flex-1 rounded-xl border border-amber-200 bg-white py-3 text-sm font-black text-amber-700 disabled:opacity-60">
            {requestingSetup ? '요청 중...' : '관리자 셋업 요청'}
          </button>
          {items.some((entry) => entry.action === 'billing') && (
            <button type="button" onClick={onGoBilling} className="flex-1 rounded-xl border border-amber-200 bg-white py-3 text-sm font-black text-amber-700">
              결제 확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
