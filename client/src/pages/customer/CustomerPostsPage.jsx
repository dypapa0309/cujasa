import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import TrialStatusCard from './TrialStatusCard.jsx';

function postModeLabel(postMode) {
  if (postMode === 'link') return '쿠팡 링크 글';
  if (postMode === 'no_link') return '일반 글';
  return '기존 예약 글';
}

function queueFriendly(row = {}, detail = null) {
  const queue = detail?.queue || row;
  return {
    title: queue.friendly_title || row.friendly_title || '업로드 확인이 필요합니다',
    message: queue.friendly_message || row.friendly_message || row.error_message || '확인이 필요한 항목입니다.',
    severity: queue.friendly_severity || row.friendly_severity || 'error'
  };
}

function ModeBadge({ mode, linkStatus }) {
  const isLink = mode === 'link';
  const missing = linkStatus === 'missing';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
      missing
        ? 'bg-rose-50 text-rose-600'
        : isLink
          ? 'bg-blue-50 text-blue-600'
          : 'bg-gray-100 text-gray-500'
    }`}>
      {missing ? '상품 매칭 누락' : postModeLabel(mode)}
    </span>
  );
}

export default function CustomerPostsPage({ account, pipelineResult, trialStatus, setTab }) {
  const [queue, setQueue] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [loadingDetailId, setLoadingDetailId] = useState(null);

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

  const toggleDetail = async (queueId) => {
    if (expandedId === queueId) { setExpandedId(null); return; }
    setExpandedId(queueId);
    if (detail[queueId]) return;
    setLoadingDetailId(queueId);
    try {
      const d = await api.get(`/api/queue/detail/${queueId}`);
      setDetail((p) => ({ ...p, [queueId]: d }));
    } catch {}
    finally { setLoadingDetailId(null); }
  };

  const getPost = (postId) => posts.find((p) => p.id === postId);

  const scheduled = queue.filter((r) => r.status === 'scheduled').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const posted = queue.filter((r) => r.status === 'posted').sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));
  const needsAttention = queue
    .filter((r) => ['failed', 'retry', 'manual_required', 'skipped'].includes(r.status))
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const pipelineQueued = pipelineResult?.queuedCount ?? pipelineResult?.steps?.queued ?? 0;
  const pipelineSucceeded = (pipelineResult?.ok === true || pipelineResult?.status === 'ok') && pipelineQueued > 0;
  const pipelineTopics = pipelineResult?.topicsCount ?? pipelineResult?.steps?.topics ?? 0;
  const pipelinePosts = pipelineResult?.postsCount ?? pipelineResult?.steps?.posts ?? 0;

  if (loading) return (
    <div className="grid gap-3">
      {[...Array(5)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white border border-gray-100" />)}
    </div>
  );

  return (
    <div className="grid gap-5">
      <TrialStatusCard trialStatus={trialStatus} onUpgrade={() => setTab?.('billing')} />

      {/* 파이프라인 실행 결과 */}
      {pipelineResult && (
        <div className={`rounded-2xl px-5 py-4 text-sm font-medium ${pipelineSucceeded ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {pipelineSucceeded ? (
            <div className="grid gap-1">
              <div className="font-bold flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
                예약 생성 완료
              </div>
              <div className="text-xs opacity-80">
                주제 {pipelineTopics}개 · 콘텐츠 {pipelinePosts}개 · {pipelineQueued}개 예약 완료
              </div>
              {(pipelineResult.warnings || []).length > 0 && (
                <div className="mt-1 text-xs opacity-80">
                  과거 실패 기록 등 경고 {pipelineResult.warnings.length}개가 있었지만 현재 실행은 완료됐습니다.
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="font-bold">예약 생성 중 오류 발생</div>
              <div className="text-xs mt-1 opacity-80">{pipelineResult.message || pipelineResult.error}</div>
              {pipelineResult.queueDiagnostics && (
                <div className="mt-2 text-[11px] opacity-70">
                  예약 시간 {pipelineResult.queueDiagnostics.scheduleCount ?? 0}개 · 링크 후보 {pipelineResult.queueDiagnostics.availableLinkPosts ?? 0}개 · 일반 후보 {pipelineResult.queueDiagnostics.availableNoLinkPosts ?? 0}개
                </div>
              )}
              {pipelineResult.stage && (
                <div className="mt-2 text-[11px] opacity-70">단계: {pipelineResult.stage}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 예약된 포스팅 */}
      {needsAttention.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">확인 필요 ({needsAttention.length})</div>
          <div className="grid gap-2">
            {needsAttention.map((r) => {
              const isExpanded = expandedId === r.id;
              const d = detail[r.id];
              const label = {
                failed: '실패',
                retry: '재시도',
                manual_required: '수동 검토',
                skipped: '취소됨',
              }[r.status] || r.status;
              const friendly = queueFriendly(r);
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-rose-100 overflow-hidden">
                  <button onClick={() => toggleDetail(r.id)} className="w-full px-5 py-4 flex items-center gap-3 text-left">
                    <div className="w-2 h-2 rounded-full bg-rose-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700">{dateTime(r.scheduled_at)}</div>
                      <div className="text-xs text-rose-500 mt-0.5 truncate">{friendly?.title || label}</div>
                    </div>
                    <span className="text-gray-300 text-sm flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 py-4 grid gap-4">
                      {loadingDetailId === r.id ? (
                        <div className="text-xs text-gray-400">불러오는 중...</div>
                      ) : d ? (
                        (() => {
                          const detailFriendly = queueFriendly(r, d);
                          return (
                        <>
                          {d.post?.body && (
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-700 leading-relaxed">{d.post.body}</pre>
                          )}
                          <div>
                            <ModeBadge mode={d.postMode || r.post_mode} linkStatus={d.linkStatus} />
                          </div>
                          {(r.error_message || d.queue?.friendly_title) && (
                            <div className="grid gap-3 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-600">
                              <div>
                                <div className="font-black">{detailFriendly.title || '업로드 오류'}</div>
                                <div className="mt-1 leading-relaxed">{detailFriendly.message || r.error_message}</div>
                              </div>
                              {(r.error_category || d.queue?.error_category) && (
                                <div className="rounded-lg bg-white/70 px-3 py-2 font-bold">
                                  관리자 전달 코드: {d.queue?.error_category || r.error_category}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                          );
                        })()
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scheduled.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">예약됨 ({scheduled.length})</div>
          <div className="grid gap-2">
            {scheduled.map((r) => {
              const isExpanded = expandedId === r.id;
              const d = detail[r.id];
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button onClick={() => toggleDetail(r.id)} className="w-full px-5 py-4 flex items-center gap-3 text-left">
                    <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700">{dateTime(r.scheduled_at)}</div>
                      {getPost(r.post_id) && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{getPost(r.post_id).body?.slice(0, 50)}...</div>
                      )}
                    </div>
                    <span className="text-gray-300 text-sm flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 py-4 grid gap-4">
                      {loadingDetailId === r.id ? (
                        <div className="text-xs text-gray-400">불러오는 중...</div>
                      ) : d ? (
                        <>
                          {d.post?.body && (
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-700 leading-relaxed">{d.post.body}</pre>
                          )}
                          <div>
                            <ModeBadge mode={d.postMode || r.post_mode} linkStatus={d.linkStatus} />
                          </div>
                          {d.products?.length > 0 && (
                            <div className="grid gap-2">
                              <div className="text-xs font-bold text-gray-400">연결 상품</div>
                              {d.products.map((p) => (
                                <a key={p.id} href={p.partner_url || p.product_url} target="_blank" rel="noreferrer"
                                  className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3 hover:border-gray-300 transition-colors">
                                  {p.product_image && <img src={p.product_image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-700 truncate">{p.product_name}</div>
                                    {p.product_price && <div className="text-xs text-coupang font-bold mt-0.5">{Number(p.product_price).toLocaleString()}원</div>}
                                  </div>
                                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 완료된 포스팅 */}
      {posted.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">완료 ({posted.length})</div>
          <div className="grid gap-2">
            {posted.map((r) => {
              const isExpanded = expandedId === r.id;
              const d = detail[r.id];
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button onClick={() => toggleDetail(r.id)} className="w-full px-5 py-4 flex items-center gap-3 text-left">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-700">{dateTime(r.posted_at)}</div>
                      {getPost(r.post_id) && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{getPost(r.post_id).body?.slice(0, 50)}...</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {r.post_url && (
                        <a href={r.post_url} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-coupang font-medium hover:underline">Threads →</a>
                      )}
                      <span className="text-gray-300 text-sm">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 py-4 grid gap-4">
                      {loadingDetailId === r.id ? (
                        <div className="text-xs text-gray-400">불러오는 중...</div>
                      ) : d ? (
                        <>
                          {d.post?.body && (
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-700 leading-relaxed">{d.post.body}</pre>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <ModeBadge mode={d.postMode || r.post_mode} linkStatus={d.linkStatus} />
                            {d.trackingLink && (
                              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600">트래킹 링크 생성됨</span>
                            )}
                          </div>
                          {d.products?.length > 0 && (
                            <div className="grid gap-2">
                              <div className="text-xs font-bold text-gray-400">연결 상품</div>
                              {d.products.map((p) => (
                                <a key={p.id} href={p.partner_url || p.product_url} target="_blank" rel="noreferrer"
                                  className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3 hover:border-gray-300 transition-colors">
                                  {p.product_image && <img src={p.product_image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-700 truncate">{p.product_name}</div>
                                    {p.product_price && <div className="text-xs text-coupang font-bold mt-0.5">{Number(p.product_price).toLocaleString()}원</div>}
                                  </div>
                                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
                                </a>
                              ))}
                            </div>
                          )}
                          {d.trackingLink && (
                            <div className="text-xs text-gray-400">
                              클릭 수: <span className="font-bold text-gray-600">{d.trackingLink.click_count ?? 0}회</span>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {posted.length === 0 && scheduled.length === 0 && needsAttention.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <div className="flex justify-center mb-3">
            <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
            </svg>
          </div>
          <div className="font-bold text-gray-700 mb-1">아직 포스팅이 없어요</div>
          <div className="text-sm text-gray-400">
            {pipelineResult?.queuedCount === 0
              ? '최근 실행에서 예약이 만들어지지 않았습니다. 자동화 실행 탭에서 원인을 확인해주세요.'
              : '설정을 완료하고 시작하면 여기에 기록됩니다'}
          </div>
        </div>
      )}
    </div>
  );
}
