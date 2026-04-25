import StatusBadge from './StatusBadge.jsx';

export default function PostCard({ post, onQueue }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-coupang">{post.content_type}</span>
        <StatusBadge status={post.status} />
      </div>
      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700">{post.body}</pre>
      <button onClick={() => onQueue(post)} className="mt-4 rounded bg-coupang px-3 py-2 text-sm font-medium text-white">큐에 넣기</button>
    </div>
  );
}
