import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { dateTime } from '../lib/format.js';

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
  return groups;
}

export default function QueuePage({ selectedAccount }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

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
    setCancellingId(row.id);
    try {
      await api.post(`/api/queue/cancel/${row.id}`, {});
      await load();
      if (detail?.queue?.id === row.id) setDetail(null);
      toast('포스팅이 취소됐습니다.', 'info');
    } catch {
      toast('취소에 실패했습니다.', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const run = async (row) => {
    await api.post(`/api/queue/${row.id}/upload-now`, {});
    await load();
  };

  const groups = groupByDate(rows);

  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <button onClick={async () => { await api.post(`/api/accounts/${selectedAccount.id}/create-daily-queue`, {}); await load(); toast('일일 큐가 생성됐습니다.', 'success'); }} className="rounded border border-line bg-white px-4 py-2 text-sm">일일 큐 생성</button>
        <button onClick={async () => { await api.post('/api/scheduler/run', {}); await load(); }} className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white">스케줄러 실행</button>
      </div>

      <div className={`grid gap-4 ${detail ? 'lg:grid-cols-2' : ''}`}>
        <div className="grid gap-4">
          {rows.length === 0 && <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">예약된 포스팅이 없습니다</div>}
          {Object.entries(groups).map(([label, items]) => items.length === 0 ? null : (
            <div key={label} className="grid gap-2">
              <div className="text-xs font-semibold text-slate-500 px-1">{label} ({items.length})</div>
              {items.map((row) => (
                <QueueRow key={row.id} row={row} onDetail={openDetail} onCancel={cancel} onRun={run} cancelling={cancellingId === row.id} active={detail?.queue?.id === row.id} />
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

function QueueRow({ row, onDetail, onCancel, onRun, cancelling, active }) {
  return (
    <div className={`rounded border bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer transition-colors ${active ? 'border-coupang bg-red-50/30' : 'border-line hover:border-slate-300'}`}
      onClick={() => onDetail(row)}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <StatusBadge status={row.status} />
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{dateTime(row.scheduled_at)}</div>
          {row.posted_at && <div className="text-xs text-slate-400">업로드: {dateTime(row.posted_at)}</div>}
          {row.post_url && <a href={row.post_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-coupang truncate block hover:underline">{row.post_url}</a>}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {row.status === 'scheduled' && (
          <>
            <button onClick={() => onRun(row)} className="rounded border border-line px-3 py-1.5 text-xs hover:bg-panel">지금 실행</button>
            <button onClick={() => onCancel(row)} disabled={cancelling} className="rounded border border-red-200 text-red-500 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50">
              {cancelling ? '취소 중...' : '취소'}
            </button>
          </>
        )}
        {(row.status === 'failed' || row.status === 'retry') && (
          <button onClick={() => onRun(row)} className="rounded bg-coupang px-3 py-1.5 text-xs text-white">재시도</button>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ detail, onClose }) {
  const { post, products, trackingLink, queue } = detail;
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">포스팅 상세</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
      </div>

      {/* 글 내용 */}
      {post ? (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">글 내용 ({post.content_type})</div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700 bg-gray-50 rounded p-3 border border-line">{post.body}</pre>
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
                    <div className="text-xs text-slate-400 mt-0.5">₩{Number(p.product_price || 0).toLocaleString()}</div>
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
          <div className="text-xs font-semibold text-slate-500 mb-1.5">트래킹 링크</div>
          <div className="rounded border border-line p-3 bg-gray-50">
            <div className="text-xs text-slate-600 font-mono">{baseUrl}/r/{trackingLink.code}</div>
            <div className="text-xs text-slate-400 mt-1">→ {trackingLink.destination_url}</div>
          </div>
        </div>
      )}

      {/* 에러 메시지 */}
      {queue.error_message && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-600 mb-1">오류</div>
          <div className="text-xs text-red-500">{queue.error_message}</div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
