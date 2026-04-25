export default function TopicCard({ topic, onSearch, onGenerate }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="text-xs font-medium uppercase text-coupang">{topic.expected_intent}</div>
      <h3 className="mt-1 font-semibold">{topic.title}</h3>
      <p className="mt-1 text-sm text-slate-600">{topic.angle}</p>
      <p className="mt-2 text-sm text-slate-500">{topic.reason}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(topic.search_keywords || []).map((k) => <span key={k} className="rounded border border-line px-2 py-1 text-xs">{k}</span>)}
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={() => onSearch(topic)} className="rounded border border-line px-3 py-2 text-sm">상품 검색</button>
        <button onClick={() => onGenerate(topic)} className="rounded bg-ink px-3 py-2 text-sm text-white">콘텐츠 생성</button>
      </div>
    </div>
  );
}
