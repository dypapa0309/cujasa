import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';

export default function CustomerPostsPage({ account, pipelineResult }) {
  const [queue, setQueue] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const load = () => {
    if (!account) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/accounts/${account.id}/queue`),
      api.get(`/api/accounts/${account.id}/posts`),
    ]).then(([q, p]) => {
      setQueue(q);
      setPosts(p);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [account?.id]);
  useEffect(() => { if (pipelineResult) load(); }, [pipelineResult]);

  const posted = queue
    .filter((r) => r.status === 'posted')
    .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));

  const scheduled = queue
    .filter((r) => r.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const getPost = (postId) => posts.find((p) => p.id === postId);

  if (loading) return (
    <div className="grid gap-3">
      {[...Array(5)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white border border-gray-100" />)}
    </div>
  );

  return (
    <div className="grid gap-5">

      {/* 파이프라인 실행 결과 */}
      {pipelineResult && (
        <div className={`rounded-2xl px-5 py-4 text-sm font-medium ${pipelineResult.status === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {pipelineResult.status === 'ok' ? (
            <div className="grid gap-1">
              <div className="font-bold">자동화 실행 완료 ✓</div>
              <div className="text-xs opacity-80">
                주제 {pipelineResult.steps?.topics ?? 0}개 생성 · 콘텐츠 {pipelineResult.steps?.posts ?? 0}개 작성 · {pipelineResult.steps?.queued ?? 0}개 예약 완료
              </div>
            </div>
          ) : (
            <div>
              <div className="font-bold">실행 중 오류 발생</div>
              <div className="text-xs mt-1 opacity-80">{pipelineResult.error}</div>
            </div>
          )}
        </div>
      )}

      {/* 예약된 포스팅 */}
      {scheduled.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">
            예약됨 ({scheduled.length})
          </div>
          <div className="grid gap-2">
            {scheduled.slice(0, 5).map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700">{dateTime(r.scheduled_at)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">예약 중</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 완료된 포스팅 */}
      {posted.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">
            완료 ({posted.length})
          </div>
          <div className="grid gap-2">
            {posted.map((r) => {
              const post = getPost(r.post_id);
              const isExpanded = expandedId === r.id;
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="w-full px-5 py-4 flex items-center gap-3 text-left"
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700">{dateTime(r.posted_at)}</div>
                      {post && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{post.body?.slice(0, 50)}...</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {r.post_url && (
                        <a href={r.post_url} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-coupang font-medium hover:underline">
                          Threads →
                        </a>
                      )}
                      <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isExpanded && post && (
                    <div className="px-5 pb-4 border-t border-gray-50 pt-3">
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-600 leading-relaxed">
                        {post.body}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {posted.length === 0 && scheduled.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <div className="text-3xl mb-3">📭</div>
          <div className="font-bold text-gray-700 mb-1">아직 포스팅이 없어요</div>
          <div className="text-sm text-gray-400">자동화가 시작되면 여기에 기록됩니다</div>
        </div>
      )}
    </div>
  );
}
