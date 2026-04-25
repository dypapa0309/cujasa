export default function StatusBadge({ status }) {
  const tone = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    posted: 'bg-blue-50 text-blue-700 border-blue-200',
    scheduled: 'bg-amber-50 text-amber-800 border-amber-200',
    manual_required: 'bg-rose-50 text-rose-700 border-rose-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200'
  }[status] || 'bg-slate-50 text-slate-700 border-slate-200';
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-medium border ${tone}`}>{status || '-'}</span>;
}
