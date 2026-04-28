import { useState } from 'react';
import { Home, FileText, Settings, Plus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';
import CustomerHomePage from './CustomerHomePage.jsx';
import CustomerPostsPage from './CustomerPostsPage.jsx';
import CustomerSettingsPage from './CustomerSettingsPage.jsx';

const tabs = [
  ['home', '홈', Home],
  ['posts', '포스팅 현황', FileText],
  ['settings', '설정', Settings],
];

const pages = {
  home: CustomerHomePage,
  posts: CustomerPostsPage,
  settings: CustomerSettingsPage,
};

export default function CustomerApp({ accounts, currentUser, reloadAccounts, onLogout }) {
  const toast = useToast();
  const [tab, setTab] = useState('home');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: '', account_handle: '' });

  const maxAccounts = currentUser?.maxAccounts ?? 4;
  const account = accounts[selectedIdx] ?? accounts[0];
  const Page = pages[tab];
  const canAdd = accounts.length < maxAccounts;

  const addAccount = async (e) => {
    e.preventDefault();
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <div className="font-black text-lg text-coupang tracking-tight">CUJASA</div>
            <div className="text-xs text-gray-400 mt-0.5">{currentUser.email}</div>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5">
            로그아웃
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 pb-28">
        {accounts.length === 0 ? (
          <WaitingScreen />
        ) : (
          <>
            {/* 계정 탭 */}
            <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
              {accounts.map((acc, i) => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-colors
                    ${selectedIdx === i ? 'bg-coupang text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-coupang hover:text-coupang'}`}
                >
                  {acc.name}
                </button>
              ))}
              {canAdd && (
                <button
                  onClick={() => setShowAddForm(true)}
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
              reloadAccounts={reloadAccounts}
              pipelineResult={pipelineResult}
              onPipelineDone={(result) => { setPipelineResult(result); setTab('posts'); }}
            />
          </>
        )}
      </main>

      {/* 하단 탭 */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 safe-area-bottom">
        <div className="max-w-2xl mx-auto grid grid-cols-3">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors
                ${tab === key ? 'text-coupang' : 'text-gray-400 hover:text-gray-600'}`}>
              <Icon size={20} strokeWidth={tab === key ? 2.5 : 1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function WaitingScreen() {
  return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">⚙️</div>
      <h2 className="text-xl font-black mb-2">셋업 준비 중</h2>
      <p className="text-gray-500 text-sm leading-relaxed">
        담당자가 계정을 설정하고 있습니다.<br />
        완료되면 자동으로 포스팅이 시작됩니다.
      </p>
    </div>
  );
}
