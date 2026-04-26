import { useState } from 'react';
import StatusBadge from './StatusBadge.jsx';

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function PostCard({ post, onQueue }) {
  const [queuing, setQueuing] = useState(false);

  const handleQueue = async () => {
    setQueuing(true);
    try {
      await onQueue(post);
    } finally {
      setQueuing(false);
    }
  };

  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-coupang">{post.content_type}</span>
        <StatusBadge status={post.status} />
      </div>
      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700">{post.body}</pre>
      <button
        onClick={handleQueue}
        disabled={queuing}
        className="mt-4 flex items-center gap-1.5 rounded bg-coupang px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {queuing && <Spinner />}
        {queuing ? '추가 중...' : '큐에 넣기'}
      </button>
    </div>
  );
}
