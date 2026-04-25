import { price } from '../lib/format.js';

export default function ProductCard({ product }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="aspect-[4/3] rounded bg-panel">
        {product.product_image ? <img className="h-full w-full rounded object-cover" src={product.product_image} alt="" /> : null}
      </div>
      <h3 className="mt-3 line-clamp-2 font-medium">{product.product_name}</h3>
      <p className="mt-1 text-sm text-slate-600">{price(product.product_price)}</p>
      <p className="mt-1 text-xs text-slate-500">{product.keyword} · {product.is_fallback ? 'fallback' : 'api'}</p>
    </div>
  );
}
