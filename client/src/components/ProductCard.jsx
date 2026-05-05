import { price } from '../lib/format.js';

const issueLabels = {
  fallback: '검색 링크',
  fallback_id: '검색 링크',
  fallback_category: '검색 링크',
  missing_name: '상품명 없음',
  missing_image: '이미지 없음',
  missing_price: '가격 없음',
  missing_url: 'URL 없음'
};

export default function ProductCard({ product, onSelect, selecting = false, onCopied }) {
  const isReal = product.is_real_product !== false;
  const issues = product.quality_issues || [];
  const canSelect = isReal && !product.selected && onSelect;
  const productLink = product.partner_url || product.product_url || '';
  const displayPrice = product.is_fallback ? '수익화 링크 아님' : price(product.product_price);
  const copyLink = async () => {
    if (!isReal || !productLink) return;
    await navigator.clipboard.writeText(productLink);
    onCopied?.(product);
  };
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="aspect-[4/3] rounded bg-panel">
        {product.product_image ? <img className="h-full w-full rounded object-cover" src={product.product_image} alt="" /> : null}
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-medium">{product.product_name}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${isReal ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
          {isReal ? '실상품' : '사용불가'}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{displayPrice}</p>
      <p className="mt-1 text-xs text-slate-500">{product.keyword} · {product.is_fallback ? 'fallback' : 'api'}</p>
      {!isReal && issues.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-rose-500">
          {issues.map((issue) => issueLabels[issue] || issue).filter(Boolean).join(' · ')}
        </p>
      )}
      {product.selected && (
        <p className="mt-2 rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">
          선택됨 · rank {product.selected_rank}
        </p>
      )}
      {product.selected_invalid && (
        <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">
          과거 선택 기록 · 실상품 아님
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={isReal && productLink ? productLink : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!isReal || !productLink}
          className={`rounded px-3 py-2 text-center text-xs font-bold ${
            isReal && productLink
              ? 'border border-line bg-white text-slate-600 hover:bg-slate-50'
              : 'pointer-events-none bg-slate-100 text-slate-400'
          }`}
        >
          쿠팡 링크 열기
        </a>
        <button
          type="button"
          onClick={copyLink}
          disabled={!isReal || !productLink}
          className={`rounded px-3 py-2 text-xs font-bold ${
            isReal && productLink
              ? 'border border-line bg-white text-slate-600 hover:bg-slate-50'
              : 'bg-slate-100 text-slate-400'
          }`}
        >
          링크 복사
        </button>
      </div>
      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(product)}
          disabled={!canSelect || selecting}
          className={`mt-3 w-full rounded px-3 py-2 text-xs font-bold ${
            canSelect
              ? 'bg-coupang text-white hover:bg-blue-700'
              : 'bg-slate-100 text-slate-400'
          }`}
        >
          {product.selected ? '이미 연결됨' : isReal ? (selecting ? '연결 중...' : '이 상품 연결') : '실상품만 연결 가능'}
        </button>
      )}
    </div>
  );
}
