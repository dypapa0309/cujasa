export default function InsightCard({ title, detail }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}
