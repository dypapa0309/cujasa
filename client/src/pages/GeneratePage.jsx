import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import TopicCard from '../components/TopicCard.jsx';
import PostCard from '../components/PostCard.jsx';

export default function GeneratePage({ selectedAccount }) {
  const [topics, setTopics] = useState([]);
  const [posts, setPosts] = useState([]);
  const [busyTopicId, setBusyTopicId] = useState(null);
  const [busyAction, setBusyAction] = useState(null);

  const load = async () => {
    if (!selectedAccount) return;
    const [t, p] = await Promise.all([
      api.get(`/api/accounts/${selectedAccount.id}/topics`),
      api.get(`/api/accounts/${selectedAccount.id}/posts`),
    ]);
    setTopics(t);
    setPosts(p);
  };

  useEffect(() => { load().catch(console.error); }, [selectedAccount?.id]);

  const generateTopics = async () => {
    setBusyAction('주제 자동 생성 중');
    try {
      await api.post(`/api/accounts/${selectedAccount.id}/generate-topics`, {});
      await load();
    } finally {
      setBusyAction(null);
    }
  };

  const search = async (topic) => {
    setBusyTopicId(topic.id);
    setBusyAction('상품 검색 중');
    try {
      await api.post(`/api/topics/${topic.id}/search-products`, {});
      await api.post(`/api/topics/${topic.id}/select-products`, {});
      await load();
    } finally {
      setBusyTopicId(null);
      setBusyAction(null);
    }
  };

  const generate = async (topic) => {
    setBusyTopicId(topic.id);
    setBusyAction('콘텐츠 생성 중');
    try {
      await api.post(`/api/topics/${topic.id}/generate-posts`, {});
      await load();
    } finally {
      setBusyTopicId(null);
      setBusyAction(null);
    }
  };

  const queue = async (post) => {
    await api.post(`/api/posts/${post.id}/add-to-queue`, {});
    await load();
  };

  const isGlobalBusy = busyAction === '주제 자동 생성 중';

  return (
    <div className="grid gap-5">
      {/* 상단 액션바 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{selectedAccount?.name}</div>
        <button
          disabled={!!busyAction || !selectedAccount}
          onClick={generateTopics}
          className="flex items-center gap-2 rounded bg-coupang px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isGlobalBusy && <Spinner />}
          {isGlobalBusy ? '생성 중...' : '주제 자동 생성'}
        </button>
      </div>

      {/* 전역 로딩 배너 */}
      {busyAction && (
        <div className="flex items-center gap-3 rounded-lg border border-coupang/20 bg-red-50 px-4 py-3 text-sm font-medium text-coupang">
          <Spinner className="text-coupang" />
          {busyAction}... 잠시만 기다려주세요
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <h2 className="font-semibold">주제</h2>
          {topics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              onSearch={search}
              onGenerate={generate}
              loadingAction={busyTopicId === topic.id ? busyAction : null}
              disabled={!!busyAction}
            />
          ))}
        </div>
        <div className="grid gap-3 content-start">
          <h2 className="font-semibold">콘텐츠</h2>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onQueue={queue} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Spinner({ className = '' }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
