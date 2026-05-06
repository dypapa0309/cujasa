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
  const [searchBlock, setSearchBlock] = useState(null);
  const [lastSearchStatus, setLastSearchStatus] = useState(null);
  const [now, setNow] = useState(Date.now());

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

  useEffect(() => {
    setSearchBlock(null);
    setLastSearchStatus(null);
    loadProducts();
  }, [topicId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const searchProducts = async () => {
    if (!topicId || actioning) return;
    setActioning(true);
    try {
      const result = await api.post(`/api/topics/${topicId}/search-products`);
      if (result.blocked) {
        const waitUntil = result.cooldownUntil
          ? new Date(result.cooldownUntil).getTime()
          : Date.now() + Number(result.retryAfterMs || 0);
        setSearchBlock({
          reasonCode: result.reasonCode,
          waitUntil: Number.isFinite(waitUntil) ? waitUntil : null
        });
      } else {
        setSearchBlock(null);
      }
      setLastSearchStatus(result.reasonCode ? {
        reasonCode: result.reasonCode,
        message: result.message,
        realCount: result.realCount
      } : null);
      await loadProducts();
      toast(
        result.blocked
          ? '쿠팡 검색 보호로 추가 요청을 건너뛰었습니다.'
          : result.realCount > 0
            ? '상품 검색을 다시 실행했습니다.'
            : (result.message || '실상품 검색 결과가 없습니다.'),
        result.blocked || result.realCount === 0 ? 'error' : 'success'
      );
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
  const selectedRealCount = products.filter((product) => product.selected && product.is_real_product !== false).length;
  const invalidSelectedCount = products.filter((product) => product.selected_invalid).length;
  const fallbackCount = products.length - realCount;
  const needsRealLinkRecovery = selectedAccount && selectedRealCount === 0;
  const waitMs = searchBlock?.waitUntil ? Math.max(0, searchBlock.waitUntil - now) : 0;
  const searchBlocked = waitMs > 0;
  const waitSeconds = Math.ceil(waitMs / 1000);

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
          <button type="button" onClick={searchProducts} disabled={!topicId || actioning || searchBlocked} className="rounded border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50">
            {searchBlocked ? `재검색 대기 ${waitSeconds}초` : '상품 재검색'}
          </button>
          <button type="button" onClick={autoSelectProducts} disabled={!topicId || actioning} className="rounded bg-coupang px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            실상품 자동 연결
          </button>
        </div>
      </div>

      {(products.length > 0 || selectedAccount) && (
        <div className={`rounded border px-4 py-3 text-sm ${needsRealLinkRecovery ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-line bg-white text-slate-600'}`}>
          <div className="font-semibold">
            {needsRealLinkRecovery ? '실상품 링크 복구 필요' : '상품 링크 상태'}
          </div>
          <div className="mt-1">
            실상품 {realCount}개 · 선택된 실상품 {selectedRealCount}개 · 사용불가 {fallbackCount}개
          </div>
          {(fallbackCount > 0 || invalidSelectedCount > 0) && (
            <div className="mt-1 text-xs text-rose-500">
              예전 검색 실패로 저장된 임시상품과 과거 무효 선택 {invalidSelectedCount}개는 링크 포스팅에 사용할 수 없습니다.
            </div>
          )}
          {needsRealLinkRecovery && (
            <div className="mt-2 text-xs leading-relaxed">
              쿠팡 상태는 정상이어도 현재 주제에는 실제 쿠팡 상품이 없습니다. 상품 재검색을 1회 실행한 뒤, 실상품 카드를 선택하세요. probe 성공 전에는 자동화를 다시 켜지 않는 것이 안전합니다.
            </div>
          )}
        </div>
      )}

      {searchBlock && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
          {searchBlock.reasonCode === 'COUPANG_RATE_LIMIT'
            ? '쿠팡 요청 제한 보호 중입니다. 쿨다운 후 다시 검색하세요.'
            : '계정 단위 검색 간격 보호 중입니다. 잠시 후 다시 검색하세요.'}
        </div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 animate-pulse rounded border border-line bg-white" />)}
        </div>
      )}

      {!loading && products.length === 0 && topicId && (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-500">
          <div className="font-semibold text-slate-700">실상품 검색 필요</div>
          <div className="mt-2">
            {lastSearchStatus?.message || '이 주제에 연결 가능한 실제 쿠팡 상품이 없습니다.'}
          </div>
          <span className="mt-2 block text-xs text-slate-400">
            상품 재검색을 1회 실행한 뒤, 실상품이 나오면 자동 연결을 진행해주세요.
          </span>
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
              onCopied={() => toast('쿠팡 링크를 복사했습니다.', 'success')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
