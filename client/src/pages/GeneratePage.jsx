import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import TopicCard from '../components/TopicCard.jsx';
import PostCard from '../components/PostCard.jsx';

export default function GeneratePage({ selectedAccount }) {
  const toast = useToast();
  const [topics, setTopics] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyTopicId, setBusyTopicId] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualAngle, setManualAngle] = useState('');
  const [tab, setTab] = useState('valid');
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const load = async () => {
    if (!selectedAccount) return;
    const [t, p] = await Promise.all([
      api.get(`/api/accounts/${selectedAccount.id}/topics`),
      api.get(`/api/accounts/${selectedAccount.id}/posts`),
    ]);
    setTopics(t);
    setPosts(p);
  };

  const loadCleanupPreview = async () => {
    if (!selectedAccount) return;
    setCleanupLoading(true);
    try {
      setCleanupPreview(await api.post('/api/admin/operations/cleanup-unused-artifacts', {
        mode: 'dry-run',
        accountId: selectedAccount.id,
        retentionDays: 7
      }));
    } finally {
      setCleanupLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([load(), loadCleanupPreview()])
      .catch(() => toast('데이터를 불러오지 못했습니다.', 'error'))
      .finally(() => setLoading(false));
  }, [selectedAccount?.id]);

  const generateTopics = async () => {
    setBusyAction('주제 자동 생성 중');
    try {
      await api.post(`/api/accounts/${selectedAccount.id}/generate-topics`, {});
      await load();
      toast('주제가 생성됐습니다.', 'success');
    } catch {
      toast('주제 생성에 실패했습니다.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const search = async (topic) => {
    setBusyTopicId(topic.id);
    setBusyAction('상품 검색 중');
    try {
      await api.post(`/api/topics/${topic.id}/search-products`, {});
      const selected = await api.post(`/api/topics/${topic.id}/select-products`, {});
      await load();
      toast(`상품 ${selected.length}개 검색 완료`, 'success');
    } catch (error) {
      toast(error.message || '상품 검색에 실패했습니다.', 'error');
    } finally {
      setBusyTopicId(null);
      setBusyAction(null);
    }
  };

  const generate = async (topic) => {
    setBusyTopicId(topic.id);
    setBusyAction('콘텐츠 생성 중');
    try {
      const created = await api.post(`/api/topics/${topic.id}/generate-posts`, {});
      await load();
      toast(`콘텐츠 ${created.length}개 생성됐습니다.`, 'success');
    } catch (error) {
      toast(error.message || '콘텐츠 생성에 실패했습니다.', 'error');
    } finally {
      setBusyTopicId(null);
      setBusyAction(null);
    }
  };

  const queue = async (post) => {
    try {
      await api.post(`/api/posts/${post.id}/add-to-queue`, {});
      await load();
      toast('큐에 추가됐습니다.', 'success');
    } catch (error) {
      toast(error.message || '큐 추가에 실패했습니다.', 'error');
    }
  };

  const submitManualTopic = async (e) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;
    setBusyAction('주제 등록 중');
    try {
      await api.post(`/api/accounts/${selectedAccount.id}/manual-topic`, { title: manualTitle, angle: manualAngle });
      await load();
      setManualTitle('');
      setManualAngle('');
      setShowManualForm(false);
      toast('주제가 등록됐습니다.', 'success');
    } catch {
      toast('주제 등록에 실패했습니다.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const applyCleanup = async () => {
    if (!selectedAccount) return;
    if (!confirm('삭제 예정 주제/콘텐츠를 정리할까요? 예약/게시 이력이 있는 데이터는 삭제되지 않습니다.')) return;
    setCleanupLoading(true);
    try {
      const result = await api.post('/api/admin/operations/cleanup-unused-artifacts', {
        mode: 'apply',
        accountId: selectedAccount.id,
        retentionDays: 7
      });
      toast(`미사용 주제 ${result.topicCount || 0}개를 정리했습니다.`, 'success');
      await load();
      await loadCleanupPreview();
    } catch (error) {
      toast(error.message || '삭제 예정 정리에 실패했습니다.', 'error');
    } finally {
      setCleanupLoading(false);
    }
  };

  const isGlobalBusy = busyAction === '주제 자동 생성 중';
  const cleanupTopicIds = new Set(cleanupPreview?.topicIds || []);
  const validTopics = topics.filter((topic) => !cleanupTopicIds.has(topic.id));
  const cleanupTopics = topics.filter((topic) => cleanupTopicIds.has(topic.id));
  const validPosts = posts.filter((post) => !cleanupTopicIds.has(post.topic_id));
  const cleanupPosts = posts.filter((post) => cleanupTopicIds.has(post.topic_id));
  const visibleTopics = tab === 'cleanup' ? cleanupTopics : validTopics;
  const visiblePosts = tab === 'cleanup' ? cleanupPosts : validPosts;

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{selectedAccount?.name}</div>
        <div className="flex gap-2">
          <button
            disabled={!!busyAction || !selectedAccount}
            onClick={() => setShowManualForm((v) => !v)}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            직접 입력
          </button>
          <button
            disabled={!!busyAction || !selectedAccount}
            onClick={generateTopics}
            className="flex items-center gap-2 rounded bg-coupang px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {isGlobalBusy && <Spinner />}
            {isGlobalBusy ? '생성 중...' : '주제 자동 생성'}
          </button>
        </div>
      </div>

      {showManualForm && (
        <form onSubmit={submitManualTopic} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-700">주제 직접 입력</div>
          <input
            type="text"
            placeholder="주제 제목 (예: 여름 냄새 줄이는 법)"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            className="rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-coupang"
            required
          />
          <input
            type="text"
            placeholder="각도 (선택, 예: 원인부터 잡기)"
            value={manualAngle}
            onChange={(e) => setManualAngle(e.target.value)}
            className="rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-coupang"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!!busyAction || !manualTitle.trim()}
              className="flex items-center gap-2 rounded bg-coupang px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busyAction === '주제 등록 중' && <Spinner />}
              등록
            </button>
          </div>
        </form>
      )}

      {busyAction && (
        <div className="flex items-center gap-3 rounded-lg border border-coupang/20 bg-red-50 px-4 py-3 text-sm font-medium text-coupang">
          <Spinner className="text-coupang" />
          {busyAction}... 잠시만 기다려주세요
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-white p-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => setTab('valid')} className={`rounded px-3 py-2 text-sm font-bold ${tab === 'valid' ? 'bg-coupang text-white' : 'bg-panel text-slate-600'}`}>
            유효 {validTopics.length}
          </button>
          <button type="button" onClick={() => setTab('cleanup')} className={`rounded px-3 py-2 text-sm font-bold ${tab === 'cleanup' ? 'bg-coupang text-white' : 'bg-panel text-slate-600'}`}>
            삭제 예정 {cleanupPreview?.topicCount || 0}
          </button>
        </div>
        {tab === 'cleanup' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">7일 초과 · 큐 이력 없음</span>
            <button type="button" onClick={loadCleanupPreview} disabled={cleanupLoading} className="rounded border border-line px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50">
              {cleanupLoading ? '확인 중...' : '다시 확인'}
            </button>
            <button type="button" onClick={applyCleanup} disabled={cleanupLoading || !cleanupPreview?.topicCount} className="rounded bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              삭제 예정 정리 실행
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} />)}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <h2 className="font-semibold">{tab === 'cleanup' ? '삭제 예정 주제' : '유효 주제'} ({visibleTopics.length})</h2>
            {visibleTopics.length === 0 && !busyAction && (
              <div className="rounded border border-line bg-white p-6 text-center text-sm text-slate-400">
                {tab === 'cleanup' ? '삭제 예정 주제가 없습니다' : '주제 자동 생성을 눌러 시작하세요'}
              </div>
            )}
            {[...visibleTopics].reverse().map((topic) => (
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
            <h2 className="font-semibold">{tab === 'cleanup' ? '삭제 예정 콘텐츠' : '유효 콘텐츠'} ({visiblePosts.length})</h2>
            {visiblePosts.length === 0 && (
              <div className="rounded border border-line bg-white p-6 text-center text-sm text-slate-400">
                {tab === 'cleanup' ? '삭제 예정 콘텐츠가 없습니다' : '주제를 선택하고 콘텐츠 생성을 눌러주세요'}
              </div>
            )}
            {visiblePosts.map((post) => (
              <PostCard key={post.id} post={post} onQueue={queue} topics={topics} />
            ))}
          </div>
        </div>
      )}
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

function Skeleton() {
  return <div className="h-36 animate-pulse rounded border border-line bg-white" />;
}
