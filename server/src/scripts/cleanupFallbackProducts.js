import { dbDelete, dbInsert, dbList } from '../services/supabaseService.js';

const apply = process.argv.includes('--apply');

function isFallbackProduct(product = {}) {
  return Boolean(
    product.is_fallback === true
    || String(product.product_id || '').startsWith('fallback-')
    || String(product.category_name || '').toLowerCase() === 'fallback'
  );
}

function summarizeByAccount(products) {
  const counts = new Map();
  for (const product of products) {
    const key = product.account_id || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([accountId, count]) => ({ accountId, count }));
}

async function main() {
  const [products, postProducts, queues] = await Promise.all([
    dbList('coupang_products'),
    dbList('post_products'),
    dbList('post_queue')
  ]);

  const fallbackProducts = products.filter(isFallbackProduct);
  const postProductsByProductId = new Map();
  for (const row of postProducts) {
    if (!row.product_id) continue;
    const rows = postProductsByProductId.get(row.product_id) || [];
    rows.push(row);
    postProductsByProductId.set(row.product_id, rows);
  }

  const queuesByPostId = new Map();
  for (const queue of queues) {
    if (!queue.post_id) continue;
    const rows = queuesByPostId.get(queue.post_id) || [];
    rows.push(queue);
    queuesByPostId.set(queue.post_id, rows);
  }

  const deletable = [];
  const skipped = [];
  const linkRowsToDelete = [];

  for (const product of fallbackProducts) {
    const links = postProductsByProductId.get(product.id) || [];
    const hasPostedQueue = links.some((link) => {
      const postQueues = queuesByPostId.get(link.post_id) || [];
      return postQueues.some((queue) => queue.status === 'posted');
    });

    if (hasPostedQueue) {
      skipped.push({
        productId: product.id,
        productName: product.product_name,
        reason: 'posted_queue_linked',
        linkedRows: links.length
      });
      continue;
    }

    deletable.push(product);
    linkRowsToDelete.push(...links);
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    fallbackTotal: fallbackProducts.length,
    deleteProducts: deletable.length,
    deletePostProductRows: linkRowsToDelete.length,
    skippedProducts: skipped.length,
    byAccount: summarizeByAccount(fallbackProducts)
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    if (skipped.length) {
      console.log('\nSkipped sample:');
      console.log(JSON.stringify(skipped.slice(0, 10), null, 2));
    }
    console.log('\nDry-run only. Re-run with --apply to delete fallback products that are not linked to posted queues.');
    return;
  }

  for (const row of linkRowsToDelete) {
    await dbDelete('post_products', { id: row.id });
  }
  for (const product of deletable) {
    await dbDelete('coupang_products', { id: product.id });
  }

  await dbInsert('activity_logs', {
    action: 'fallback_products_cleanup',
    level: 'warn',
    message: 'fallback 쿠팡 상품 데이터를 정리했습니다.',
    payload: summary
  }).catch(() => null);

  console.log('\nApplied fallback cleanup.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
