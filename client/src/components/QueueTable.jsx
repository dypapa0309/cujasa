import StatusBadge from './StatusBadge.jsx';
import { dateTime } from '../lib/format.js';

export default function QueueTable({ rows, onRetry }) {
  return (
    <div className="overflow-hidden rounded border border-line bg-white">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-panel text-slate-600">
          <tr>
            <th className="p-3">상태</th>
            <th className="p-3">예약</th>
            <th className="p-3">업로드</th>
            <th className="p-3">URL</th>
            <th className="p-3">재시도</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="p-3"><StatusBadge status={row.status} /></td>
              <td className="p-3">{dateTime(row.scheduled_at)}</td>
              <td className="p-3">{dateTime(row.posted_at)}</td>
              <td className="p-3 text-coupang">{row.post_url || '-'}</td>
              <td className="p-3"><button onClick={() => onRetry(row)} className="rounded border border-line px-2 py-1">실행</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
