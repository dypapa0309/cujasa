import { useState } from 'react';
import { Home, FileText, Settings } from 'lucide-react';
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
  const [tab, setTab] = useState('home');
  const account = accounts[0]; // 첫 번째 계정 기준 (다중 계정이면 추후 선택 추가)
  const Page = pages[tab];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <div className="font-black text-lg text-coupang tracking-tight">CUJASA</div>
            <div className="text-xs text-gray-400 mt-0.5">{currentUser.email}</div>
          </div>
          {accounts.length > 0 && (
            <div className="text-right">
              <div className="text-xs text-gray-400">운영 계정</div>
              <div className="text-sm font-bold text-gray-700">{account?.name}</div>
            </div>
          )}
          <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 ml-3">
            로그아웃
          </button>
        </div>
      </header>

      {/* 콘텐츠 */}
      <main className="max-w-2xl mx-auto px-5 py-6 pb-28">
        {accounts.length === 0 ? (
          <WaitingScreen />
        ) : (
          <Page account={account} accounts={accounts} currentUser={currentUser} reloadAccounts={reloadAccounts} />
        )}
      </main>

      {/* 하단 탭 바 */}
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
