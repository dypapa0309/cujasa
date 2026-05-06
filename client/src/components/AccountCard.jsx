import StatusBadge from './StatusBadge.jsx';

export default function AccountCard({ account, onSelect }) {
  return (
    <button onClick={() => onSelect?.(account)} className="focus-ring w-full rounded border border-line bg-white p-4 text-left hover:border-coupang">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{account.name}</h3>
          <p className="mt-1 text-sm text-slate-500">{account.target_audience || '타깃 미설정'}</p>
          <p className="mt-1 text-xs text-slate-400">
            {account.owner_label || '고객 미할당'}{account.account_handle ? ` · ${account.account_handle}` : ''}
          </p>
        </div>
        <StatusBadge status={account.status} />
      </div>
      <div className="mt-3 text-sm text-slate-600">{account.content_scope}</div>
    </button>
  );
}
