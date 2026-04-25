import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import ProductCard from '../components/ProductCard.jsx';

export default function ProductResultPage({ selectedAccount }) {
  const [topics, setTopics] = useState([]);
  const [products, setProducts] = useState([]);
  const [topicId, setTopicId] = useState('');
  useEffect(() => {
    if (!selectedAccount) return;
    api.get(`/api/accounts/${selectedAccount.id}/topics`).then((rows) => {
      setTopics(rows);
      setTopicId((id) => id || rows[0]?.id || '');
    }).catch(console.error);
  }, [selectedAccount?.id]);
  useEffect(() => {
    if (topicId) api.get(`/api/topics/${topicId}/products`).then(setProducts).catch(console.error);
  }, [topicId]);
  return (
    <div className="grid gap-4">
      <select className="max-w-md rounded border border-line px-3 py-2" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
        {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
      </select>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {products.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>
    </div>
  );
}
