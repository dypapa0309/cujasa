export default function MetricCard({ label, value }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}
