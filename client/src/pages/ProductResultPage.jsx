import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import ProductCard from '../components/ProductCard.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { patchById } from '../lib/collection.js';

export default function ProductResultPage({ selectedAccount }) {
  const toast = useToast();
  const [topics, setTopics] = useState([]);
  const [summary, setSummary] = useState([]);
  const [filter, setFilter] = useState('needs');
  const [products, setProducts] = useState([]);
  const [topicId, setTopicId] = useState('');
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [selectingId, setSelectingId] = useState('');
  const [searchBlock, setSearchBlock] = useState(null);
  const [lastSearchStatus, setLastSearchStatus] = useState(null);
  const [now, setNow] = useState(Date.now());

  const loadSummary = async () => {
    if (!selectedAccount) return;
    const [topicRows, summaryRows] = await Promise.all([
      api.get(`/api/accounts/${selectedAccount.id}/topics`),
      api.get(`/api/accounts/${selectedAccount.id}/product-summary`)
    ]);
    setTopics(topicRows);
    setSummary(summaryRows);
    setTopicId((id) => id || summaryRows.find((row) => row.status !== 'connected')?.topicId || topicRows[0]?.id || '');
  };

  useEffect(() => {
    loadSummary().catch(console.error);
  }, [selectedAccount?.id]);

  const loadProducts = ({ silent = false } = {}) => {
    if (!topicId) return Promise.resolve();
    if (!silent) setLoading(true);
    return api.get(`/api/topics/${topicId}/products`)
      .then(setProducts)
      .catch(console.error)
      .finally(() => {
        if (!silent) setLoading(false);
      });
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
      await loadSummary();
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
      await loadSummary();
      toast(rows.length > 0 ? `${rows.length}개 실상품을 자동 연결했습니다.` : '연결 가능한 실상품이 없습니다.', rows.length > 0 ? 'success' : 'error');
    } catch (error) {
      toast(error.message || '상품 자동 선택에 실패했습니다.', 'error');
    } finally {
      setActioning(false);
    }
  };

  const refreshProductSelection = () => {
    loadProducts({ silent: true }).catch(console.error);
    loadSummary().catch(console.error);
  };

  const manuallySelect = async (product) => {
    if (!topicId || selectingId) return;
    const previousProducts = products;
    const previousSummary = summary;
    setSelectingId(product.id);
    setProducts((current) => patchById(current, product.id, { selected: true, selected_invalid: false }));
    setSummary((current) => current.map((row) => row.topicId === topicId ? { ...row, status: 'connected' } : row));
    try {
      await api.post(`/api/topics/${topicId}/manual-product-selection`, { productId: product.id });
      refreshProductSelection();
      toast('실상품을 주제에 연결했습니다.', 'success');
    } catch (error) {
      setProducts(previousProducts);
      setSummary(previousSummary);
      toast(error.message || '상품 연결에 실패했습니다.', 'error');
    } finally {
      setSelectingId('');
    }
  };

  const manuallyUnselect = async (product) => {
    if (!topicId || selectingId) return;
    const previousProducts = products;
    const previousSummary = summary;
    setSelectingId(product.id);
    const nextSelectedCount = products.filter((item) => item.id !== product.id && item.selected && item.is_real_product !== false).length;
    setProducts((current) => patchById(current, product.id, { selected: false }));
    setSummary((current) => current.map((row) => row.topicId === topicId
      ? { ...row, status: nextSelectedCount > 0 ? 'connected' : 'needs_selection' }
      : row
    ));
    try {
      await api.delete(`/api/topics/${topicId}/product-selection/${product.id}`);
      refreshProductSelection();
      toast('상품 연결을 해제했습니다.', 'success');
    } catch (error) {
      setProducts(previousProducts);
      setSummary(previousSummary);
      toast(error.message || '상품 연결 해제에 실패했습니다.', 'error');
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

  const selectedTopicSummary = summary.find((row) => row.topicId === topicId);
  const summaryFilters = [
    ['needs', '연결 필요', (row) => row.status === 'needs_selection' || row.status === 'no_real_products' || row.status === 'no_products'],
    ['connected', '연결됨', (row) => row.status === 'connected'],
    ['cleanup', '삭제 예정', (row) => row.cleanupCandidate],
    ['all', '전체', () => true]
  ];
  const visibleSummary = summary.filter((row) => (summaryFilters.find(([key]) => key === filter)?.[2] || (() => true))(row));
  const statusBadge = (row) => {
    if (row.status === 'connected') return ['연결됨', 'bg-emerald-50 text-emerald-600'];
    if (row.status === 'needs_selection') return ['선택 필요', 'bg-amber-50 text-amber-600'];
    if (row.status === 'no_real_products') return ['실상품 없음', 'bg-rose-50 text-rose-600'];
    return ['상품 검색 필요', 'bg-slate-100 text-slate-500'];
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid gap-3 rounded border border-line bg-white p-4">
          <div>
            <div className="text-sm font-bold text-slate-800">주제별 상품 연결 상태</div>
            <div className="mt-1 text-xs text-slate-400">연결이 필요한 주제를 먼저 보여줍니다.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {summaryFilters.map(([key, label, predicate]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded px-3 py-1.5 text-xs font-bold ${filter === key ? 'bg-coupang text-white' : 'bg-panel text-slate-600'}`}
              >
                {label} {summary.filter(predicate).length}
              </button>
            ))}
          </div>
          <div className="max-h-[520px] overflow-auto rounded border border-line">
            {visibleSummary.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">표시할 주제가 없습니다.</div>
            ) : visibleSummary.map((row) => {
              const [label, className] = statusBadge(row);
              return (
                <button
                  key={row.topicId}
                  type="button"
                  onClick={() => setTopicId(row.topicId)}
                  className={`w-full border-b border-line px-3 py-3 text-left last:border-b-0 ${topicId === row.topicId ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-bold text-slate-700">{row.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}>{label}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    실상품 {row.realCount} · 연결 {row.selectedRealCount} · 전체 {row.productCount}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="grid gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <SearchableSelect
              className="w-full max-w-md"
              value={topicId}
              onChange={setTopicId}
              options={topics.map((topic) => ({ value: topic.id, label: topic.title }))}
              placeholder="주제 선택"
              searchPlaceholder="주제 검색"
            />
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
              예전 검색 실패로 저장된 임시상품과 과거 무효 선택 {invalidSelectedCount}개는 링크 글에 사용할 수 없습니다.
            </div>
          )}
          {needsRealLinkRecovery && (
            <div className="mt-2 text-xs leading-relaxed">
              이 주제에는 아직 연결 가능한 쿠팡 상품이 없습니다. 상품 재검색을 실행한 뒤, 실상품 카드를 선택해주세요.
            </div>
          )}
          {selectedTopicSummary?.cleanupCandidate && (
            <div className="mt-2 text-xs leading-relaxed text-amber-600">
              예약에 쓰이지 않아 삭제 예정으로 분류된 주제입니다.
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
              onUnselect={manuallyUnselect}
              selecting={selectingId === product.id}
              unselecting={selectingId === product.id}
              onCopied={() => toast('쿠팡 링크를 복사했습니다.', 'success')}
            />
          ))}
        </div>
      )}
        </section>
      </div>
    </div>
  );
}
