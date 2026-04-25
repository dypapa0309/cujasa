import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import QueueTable from '../components/QueueTable.jsx';

export default function QueuePage({ selectedAccount }) {
  const [rows, setRows] = useState([]);
  const load = async () => {
    if (selectedAccount) setRows(await api.get(`/api/accounts/${selectedAccount.id}/queue`));
  };
  useEffect(() => { load().catch(console.error); }, [selectedAccount?.id]);
  const createDaily = async () => {
    await api.post(`/api/accounts/${selectedAccount.id}/create-daily-queue`, {});
    await load();
  };
  const run = async (row) => {
    await api.post(`/api/queue/${row.id}/upload-now`, {});
    await load();
  };
  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <button onClick={createDaily} className="rounded border border-line bg-white px-4 py-2">일일 큐 생성</button>
        <button onClick={async () => { await api.post('/api/scheduler/run', {}); await load(); }} className="rounded bg-coupang px-4 py-2 font-medium text-white">스케줄러 실행</button>
      </div>
      <QueueTable rows={rows} onRetry={run} />
    </div>
  );
}
