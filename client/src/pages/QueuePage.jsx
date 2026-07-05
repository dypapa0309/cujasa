import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { dateTime } from '../lib/format.js';
import { patchById } from '../lib/collection.js';

const ATTENTION_STATUSES = new Set(['failed', 'retry', 'manual_required']);
const FILTERS = [
  { key: 'attention', label: '주의 필요', match: (row) => ATTENTION_STATUSES.has(row.status) },
  { key: 'all', label: '전체', match: () => true },
  { key: 'scheduled', label: '예약', match: (row) => row.status === 'scheduled' },
  { key: 'retry', label: '재시도', match: (row) => row.status === 'retry' },
  { key: 'manual_required', label: '수동 검토', match: (row) => row.status === 'manual_required' },
  { key: 'failed', label: '실패', match: (row) => row.status === 'failed' },
  { key: 'posted', label: '게시 완료', match: (row) => row.status === 'posted' },
  { key: 'other', label: '취소/기타', match: (row) => !['scheduled', 'retry', 'manual_required', 'failed', 'posted'].includes(row.status) }
];

function groupByDate(rows) {
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);
  const groups = { '오늘': [], '내일': [], '이후': [], '완료/기타': [] };
  rows.forEach((r) => {
    const d = new Date(r.scheduled_at);
    if (!['scheduled','retry'].includes(r.status)) groups['완료/기타'].push(r);
    else if (d >= today && d < tomorrow) groups['오늘'].push(r);
    else if (d >= tomorrow && d < dayAfter) groups['내일'].push(r);
    else groups['이후'].push(r);
  });
  groups['완료/기타'].sort((a, b) => queueCompletedTime(b) - queueCompletedTime(a));
  return groups;
}

function queueCompletedTime(row = {}) {
  return new Date(row.posted_at || row.updated_at || row.created_at || row.scheduled_at || 0).getTime() || 0;
}

export default function QueuePage({ selectedAccount }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('attention');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [runningId, setRunningId] = useState(null);

  const load = async () => {
    if (selectedAccount) setRows(await api.get(`/api/accounts/${selectedAccount.id}/queue`));
  };

  useEffect(() => { load().catch(console.error); }, [selectedAccount?.id]);

  const openDetail = async (row) => {
    setLoadingDetail(true);
    setDetail(null);
    try {
      const data = await api.get(`/api/queue/detail/${row.id}`);
      setDetail(data);
    } finally {
      setLoadingDetail(false);
    }
  };

  const cancel = async (row) => {
    if (!confirm('이 포스팅을 취소하시겠습니까?')) return;
    const previousRows = rows;
    const canceledAt = new Date().toISOString();
    setCancellingId(row.id);
    setRows((current) => patchById(current, row.id, {
      status: 'canceled',
      updated_at: canceledAt,
      friendly_title: row.friendly_title || '취소됨'
    }));
    if (detail?.queue?.id === row.id) setDetail(null);
    try {
      await api.post(`/api/queue/cancel/${row.id}`, {});
      load().catch(console.error);
      toast('포스팅이 취소됐습니다.', 'info');
    } catch {
      setRows(previousRows);
      toast('취소에 실패했습니다.', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const run = async (row) => {
    const previousRows = rows;
    const startedAt = new Date().toISOString();
    setRunningId(row.id);
    setRows((current) => patchById(current, row.id, {
      status: 'posting',
      updated_at: startedAt,
      error_message: null,
      friendly_title: null
    }));
    try {
      const updated = await api.post(`/api/queue/${row.id}/upload-now`, {});
      if (updated?.id) {
        setRows((current) => patchById(current, updated.id, updated));
      }
      load().catch(console.error);
      if (detail?.queue?.id === row.id) await openDetail(updated || row);
      toast(updated?.status === 'posted' ? '업로드가 완료됐습니다.' : '처리 결과를 확인해주세요.', updated?.status === 'posted' ? 'success' : 'info');
    } catch (error) {
      setRows(previousRows);
      await load();
      toast(error.message || '업로드 실행에 실패했습니다.', 'error');
    } finally {
      setRunningId(null);
    }
  };

  const selectedFilter = FILTERS.find((item) => item.key === filter) || FILTERS[0];
  const filteredRows = rows
    .filter(selectedFilter.match)
    .sort((a, b) => filter === 'posted' ? queueCompletedTime(b) - queueCompletedTime(a) : 0);
  const groups = groupByDate(filteredRows);
  const counts = Object.fromEntries(FILTERS.map((item) => [item.key, rows.filter(item.match).length]));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded border px-3 py-2 text-xs font-semibold ${
                filter === item.key
                  ? 'border-coupang bg-red-50 text-coupang'
                  : 'border-line bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {item.label} {counts[item.key] ?? 0}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              await api.post(`/api/accounts/${selectedAccount.id}/create-daily-queue`, {});
              await load();
              toast('일일 큐가 생성됐습니다.', 'success');
            }}
            className="rounded border border-line bg-white px-4 py-2 text-sm"
          >
            일일 큐 생성
          </button>
          <button
            onClick={async () => {
              await api.post('/api/scheduler/run', {});
              await load();
            }}
            className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white"
          >
            스케줄러 실행
          </button>
        </div>
      </div>

      <div className={`grid gap-4 ${detail ? 'lg:grid-cols-2' : ''}`}>
        <div className="grid gap-4">
          {rows.length === 0 && <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">예약된 포스팅이 없습니다</div>}
          {rows.length > 0 && filteredRows.length === 0 && <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">{selectedFilter.label} 항목이 없습니다</div>}
          {Object.entries(groups).map(([label, items]) => items.length === 0 ? null : (
            <div key={label} className="grid gap-2">
              <div className="text-xs font-semibold text-slate-500 px-1">{label} ({items.length})</div>
              {items.map((row) => (
                <QueueRow key={row.id} row={row} onDetail={openDetail} onCancel={cancel} onRun={run} cancelling={cancellingId === row.id} running={runningId === row.id} active={detail?.queue?.id === row.id} />
              ))}
            </div>
          ))}
        </div>

        {/* 상세 패널 */}
        {(loadingDetail || detail) && (
          <div className="rounded border border-line bg-white p-5 text-sm self-start sticky top-20">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-slate-400"><Spinner />불러오는 중...</div>
            ) : (
              <DetailPanel detail={detail} onClose={() => setDetail(null)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({ row, onDetail, onCancel, onRun, cancelling, running, active }) {
  const friendlyTitle = row.friendly_title || row.error_message;
  const canRun = ['scheduled', 'failed', 'retry', 'manual_required'].includes(row.status);
  return (
    <div className={`rounded border bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer transition-colors ${active ? 'border-coupang bg-red-50/30' : 'border-line hover:border-slate-300'}`}
      onClick={() => onDetail(row)}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <StatusBadge status={row.status} />
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{dateTime(row.scheduled_at)}</div>
          {row.posted_at && <div className="text-xs text-slate-400">업로드: {dateTime(row.posted_at)}</div>}
          {row.post_url && <a href={row.post_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-coupang truncate block hover:underline">{row.post_url}</a>}
          {friendlyTitle && <div className="mt-1 truncate text-xs font-medium text-rose-500">{friendlyTitle}</div>}
          {row.error_category && <div className="mt-0.5 text-[11px] text-slate-400">코드: {row.error_category}</div>}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {canRun && (
          <button onClick={() => onRun(row)} disabled={running} className={`${row.status === 'scheduled' ? 'rounded border border-line px-3 py-1.5 text-xs hover:bg-panel' : 'rounded bg-coupang px-3 py-1.5 text-xs text-white'} disabled:opacity-50`}>
            {running ? '실행 중...' : row.status === 'scheduled' ? '지금 실행' : '재시도'}
          </button>
        )}
        {row.status === 'scheduled' && (
          <>
            <button onClick={() => onCancel(row)} disabled={cancelling} className="rounded border border-red-200 text-red-500 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50">
              {cancelling ? '취소 중...' : '취소'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const ENGAGEMENT_PATTERN_LABELS = {
  choice_tension: '선택 갈림형',
  experience_question: '경험 질문형',
  regret_prevention: '후회 방지형',
  empathy_prompt: '공감 질문형'
};

function QualityMeta({ post }) {
  const metadata = post?.metadata || {};
  if (!metadata.engagementScore) return null;
  const patternLabel = ENGAGEMENT_PATTERN_LABELS[metadata.engagementPattern] || metadata.engagementPattern || '패턴 미분류';
  const reasons = Array.isArray(metadata.selectionReasons) ? metadata.selectionReasons.slice(0, 3) : [];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
      <span className="rounded border border-emerald-100 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
        댓글 유도 {metadata.engagementScore}점
      </span>
      <span className="rounded border border-line bg-white px-2 py-1">{patternLabel}</span>
      {reasons.map((reason) => (
        <span key={reason} className="rounded border border-line bg-white px-2 py-1">{reason}</span>
      ))}
    </div>
  );
}

function CandidateScores({ post }) {
  const scores = Array.isArray(post?.metadata?.candidateScores) ? post.metadata.candidateScores : [];
  if (scores.length <= 1) return null;
  return (
    <details className="rounded border border-line bg-gray-50 px-3 py-2 text-xs text-slate-500">
      <summary className="cursor-pointer font-semibold text-slate-600">후보 점수/탈락 이유</summary>
      <div className="mt-2 grid gap-1">
        {scores.map((candidate) => (
          <div key={`${candidate.index}-${candidate.engagementScore}`} className="flex items-center justify-between gap-3 rounded bg-white px-2 py-1.5">
            <span className="min-w-0 truncate">
              #{Number(candidate.index) + 1} · {ENGAGEMENT_PATTERN_LABELS[candidate.engagementPattern] || candidate.engagementPattern || '패턴 미분류'}
              {candidate.rejectionReasons?.length ? ` · ${candidate.rejectionReasons.join(', ')}` : ''}
            </span>
            <span className={`shrink-0 font-semibold ${candidate.selected ? 'text-emerald-600' : 'text-slate-500'}`}>
              {candidate.selected ? '선택 ' : ''}{candidate.engagementScore}점
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function DetailPanel({ detail, onClose }) {
  const { post, products, trackingLink, queue, postMode, postModeLabel, linkStatus } = detail;
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const linkMissing = postMode === 'link' && linkStatus === 'missing';
  const linkPending = postMode === 'link' && linkStatus === 'pending_tracking';

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">포스팅 상세</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
      </div>

      <div className="grid gap-2 rounded border border-line bg-gray-50 p-3 text-xs text-slate-600">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={queue.status} />
          <span className="rounded border border-line bg-white px-2 py-1 font-medium">{postModeLabel || postMode || 'post mode unknown'}</span>
          <span className={`rounded border px-2 py-1 font-medium ${
            linkMissing
              ? 'border-rose-200 bg-rose-50 text-rose-600'
              : linkPending
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-line bg-white'
          }`}>
            {linkMissing
              ? '상품/트래킹 링크 확인 필요'
              : trackingLink
                ? '트래킹 링크 준비됨'
                : linkPending
                  ? '업로드 직전 트래킹 링크 생성 예정'
                  : '트래킹 링크 없음'}
          </span>
        </div>
        <div>재시도 횟수: <span className="font-semibold">{queue.retry_count ?? 0}</span></div>
        {queue.error_category && <div>오류 코드: <span className="font-mono font-semibold">{queue.error_category}</span></div>}
      </div>

      {/* 글 내용 */}
      {post ? (
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500">글 내용 ({post.content_type})</div>
            <QualityMeta post={post} />
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700 bg-gray-50 rounded p-3 border border-line">{post.body}</pre>
          <div className="mt-2">
            <CandidateScores post={post} />
          </div>
        </div>
      ) : (
        <div className="text-slate-400 text-xs">글 정보 없음</div>
      )}

      {/* 상품 정보 */}
      {products.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">연결된 쿠팡 상품</div>
          <div className="grid gap-2">
            {products.map((p) => (
              <div key={p.id} className="rounded border border-line p-3 bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 leading-snug">{p.product_name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{formatProductPrice(p)}</div>
                    {p.reason && <div className="text-xs text-slate-500 mt-1">{p.reason}</div>}
                  </div>
                  <span className="text-[10px] bg-white border border-line rounded px-1.5 py-0.5 text-slate-500 flex-shrink-0">#{p.rank}</span>
                </div>
                <a href={p.partner_url || p.product_url} target="_blank" rel="noreferrer" className="text-xs text-coupang mt-2 block truncate hover:underline">
                  {p.partner_url || p.product_url}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 트래킹 링크 */}
      {trackingLink && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">쿠팡 링크</div>
          <div className="rounded border border-line p-3 bg-gray-50">
            <div className="text-xs text-slate-600 break-all">{trackingLink.destination_url}</div>
            <div className="text-xs text-slate-400 mt-1">내부 추적 코드: {baseUrl}/r/{trackingLink.code}</div>
          </div>
        </div>
      )}

      {linkMissing && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-700 mb-1">링크 글 점검 필요</div>
          <div className="text-xs text-amber-700">링크 글로 예약됐지만 아직 사용할 수 있는 상품 또는 트래킹 링크가 없습니다. 상품 추천/선택 상태를 확인한 뒤 재시도해주세요.</div>
        </div>
      )}

      {linkPending && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-700 mb-1">링크 생성 대기</div>
          <div className="text-xs text-amber-700">실제 쿠팡 상품은 연결되어 있습니다. 업로드 직전에 쿠팡 링크를 최종 확인하고 본문에는 쿠팡 링크를 직접 포함합니다.</div>
        </div>
      )}

      {/* 에러 메시지 */}
      {(queue.error_message || queue.friendly_message) && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-600 mb-1">{queue.friendly_title || '오류'}</div>
          <div className="text-xs text-red-500">{queue.friendly_message || queue.error_message}</div>
        </div>
      )}
    </div>
  );
}

function formatProductPrice(product) {
  if (product.is_fallback) return '검색 링크 상품';
  const price = Number(product.product_price);
  if (!Number.isFinite(price) || price <= 0) return '가격 정보 없음';
  return `₩${price.toLocaleString()}`;
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
