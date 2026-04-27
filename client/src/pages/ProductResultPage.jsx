import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ProductCard from '../components/ProductCard.jsx';

export default function ProductResultPage({ selectedAccount }) {
  const [topics, setTopics] = useState([]);
  const [products, setProducts] = useState([]);
  const [topicId, setTopicId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedAccount) return;
    api.get(`/api/accounts/${selectedAccount.id}/topics`).then((rows) => {
      setTopics(rows);
      setTopicId((id) => id || rows[0]?.id || '');
    }).catch(console.error);
  }, [selectedAccount?.id]);

  useEffect(() => {
    if (!topicId) return;
    setLoading(true);
    api.get(`/api/topics/${topicId}/products`)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [topicId]);

  return (
    <div className="grid gap-4">
      <select
        className="max-w-md rounded border border-line px-3 py-2 text-sm"
        value={topicId}
        onChange={(e) => setTopicId(e.target.value)}
      >
        {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
      </select>

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
          {products.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      )}
    </div>
  );
}
