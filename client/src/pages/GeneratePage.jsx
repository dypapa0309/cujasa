import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import TopicCard from '../components/TopicCard.jsx';
import PostCard from '../components/PostCard.jsx';

export default function GeneratePage({ selectedAccount }) {
  const [topics, setTopics] = useState([]);
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!selectedAccount) return;
    setTopics(await api.get(`/api/accounts/${selectedAccount.id}/topics`));
    setPosts(await api.get(`/api/accounts/${selectedAccount.id}/posts`));
  };
  useEffect(() => { load().catch(console.error); }, [selectedAccount?.id]);
  const generateTopics = async () => {
    setBusy(true);
    await api.post(`/api/accounts/${selectedAccount.id}/generate-topics`, {});
    await load();
    setBusy(false);
  };
  const search = async (topic) => {
    setBusy(true);
    await api.post(`/api/topics/${topic.id}/search-products`, {});
    await api.post(`/api/topics/${topic.id}/select-products`, {});
    setBusy(false);
  };
  const generate = async (topic) => {
    setBusy(true);
    await api.post(`/api/topics/${topic.id}/generate-posts`, {});
    await load();
    setBusy(false);
  };
  const queue = async (post) => {
    await api.post(`/api/posts/${post.id}/add-to-queue`, {});
    await load();
  };
  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">{selectedAccount?.name}</div>
        <button disabled={busy || !selectedAccount} onClick={generateTopics} className="rounded bg-coupang px-4 py-2 font-medium text-white disabled:opacity-50">주제 자동 생성</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <h2 className="font-semibold">주제</h2>
          {topics.map((topic) => <TopicCard key={topic.id} topic={topic} onSearch={search} onGenerate={generate} />)}
        </div>
        <div className="grid gap-3 content-start">
          <h2 className="font-semibold">콘텐츠</h2>
          {posts.map((post) => <PostCard key={post.id} post={post} onQueue={queue} />)}
        </div>
      </div>
    </div>
  );
}
