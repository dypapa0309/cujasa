function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function TopicCard({ topic, onSearch, onGenerate, loadingAction, disabled }) {
  const searchingThis = loadingAction === '상품 검색 중';
  const generatingThis = loadingAction === '콘텐츠 생성 중';

  return (
    <div className={`rounded border border-line bg-white p-4 transition-opacity ${disabled && !loadingAction ? 'opacity-50' : ''}`}>
      <div className="text-xs font-medium uppercase text-coupang">{topic.expected_intent}</div>
      <h3 className="mt-1 font-semibold">{topic.title}</h3>
      <p className="mt-1 text-sm text-slate-600">{topic.angle}</p>
      <p className="mt-2 text-sm text-slate-500">{topic.reason}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(topic.search_keywords || []).map((k) => (
          <span key={k} className="rounded border border-line px-2 py-1 text-xs">{k}</span>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onSearch(topic)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searchingThis && <Spinner />}
          {searchingThis ? '검색 중...' : '상품 검색'}
        </button>
        <button
          onClick={() => onGenerate(topic)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded bg-ink px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generatingThis && <Spinner />}
          {generatingThis ? '생성 중...' : '콘텐츠 생성'}
        </button>
      </div>
    </div>
  );
}
