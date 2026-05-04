import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import ProductCard from '../components/ProductCard.jsx';

export default function ProductResultPage({ selectedAccount }) {
  const toast = useToast();
  const [topics, setTopics] = useState([]);
  const [products, setProducts] = useState([]);
  const [topicId, setTopicId] = useState('');
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [selectingId, setSelectingId] = useState('');

  useEffect(() => {
    if (!selectedAccount) return;
    api.get(`/api/accounts/${selectedAccount.id}/topics`).then((rows) => {
      setTopics(rows);
      setTopicId((id) => id || rows[0]?.id || '');
    }).catch(console.error);
  }, [selectedAccount?.id]);

  const loadProducts = () => {
    if (!topicId) return Promise.resolve();
    setLoading(true);
    return api.get(`/api/topics/${topicId}/products`)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, [topicId]);

  const searchProducts = async () => {
    if (!topicId || actioning) return;
    setActioning(true);
    try {
      await api.post(`/api/topics/${topicId}/search-products`);
      await loadProducts();
      toast('상품 검색을 다시 실행했습니다.', 'success');
    } catch (error) {
      toast(error.message || '상품 검색에 실패했습니다.', 'error');
    } finally {
      setActioning(false);
    }
  };

  const autoSelectProducts = async () => {
    if (!topicId || actioning) return;
    setActioning(true);
    try {
      const rows = await api.post(`/api/topics/${topicId}/select-products`);
      await loadProducts();
      toast(rows.length > 0 ? `${rows.length}개 실상품을 자동 연결했습니다.` : '연결 가능한 실상품이 없습니다.', rows.length > 0 ? 'success' : 'error');
    } catch (error) {
      toast(error.message || '상품 자동 선택에 실패했습니다.', 'error');
    } finally {
      setActioning(false);
    }
  };

  const manuallySelect = async (product) => {
    if (!topicId || selectingId) return;
    setSelectingId(product.id);
    try {
      await api.post(`/api/topics/${topicId}/manual-product-selection`, { productId: product.id });
      await loadProducts();
      toast('실상품을 주제에 연결했습니다.', 'success');
    } catch (error) {
      toast(error.message || '상품 연결에 실패했습니다.', 'error');
    } finally {
      setSelectingId('');
    }
  };

  const realCount = products.filter((product) => product.is_real_product !== false).length;
  const selectedCount = products.filter((product) => product.selected).length;
  const fallbackCount = products.length - realCount;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <select
          className="max-w-md rounded border border-line px-3 py-2 text-sm"
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
        >
          {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={searchProducts} disabled={!topicId || actioning} className="rounded border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50">
            상품 재검색
          </button>
          <button type="button" onClick={autoSelectProducts} disabled={!topicId || actioning} className="rounded bg-coupang px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            실상품 자동 연결
          </button>
        </div>
      </div>

      {products.length > 0 && (
        <div className="rounded border border-line bg-white px-4 py-3 text-sm text-slate-600">
          실상품 {realCount}개 · 사용불가 {fallbackCount}개 · 연결됨 {selectedCount}개
          {fallbackCount > 0 && <span className="ml-2 text-rose-500">검색 링크/fallback 상품은 링크 포스팅에 사용할 수 없습니다.</span>}
        </div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 animate-pulse rounded border border-line bg-white" />)}
        </div>
      )}

      {!loading && products.length === 0 && topicId && (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">
          이 주제에 검색된 상품이 없습니다.<br />
          <span className="text-xs mt-1 block">주제/콘텐츠 생성 탭에서 상품 검색을 먼저 실행해주세요.</span>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onSelect={manuallySelect}
              selecting={selectingId === product.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
