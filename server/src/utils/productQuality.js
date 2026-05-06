export function realProductIssues(product = {}) {
  const issues = [];
  if (product.is_fallback) issues.push('fallback');
  if (!product.product_name) issues.push('missing_name');
  if (!product.product_image) issues.push('missing_image');
  if (product.product_price === null || product.product_price === undefined || product.product_price === '' || Number(product.product_price) <= 0) issues.push('missing_price');
  if (!(product.partner_url || product.product_url)) issues.push('missing_url');
  if (String(product.product_id || '').startsWith('fallback-')) issues.push('fallback_id');
  if (String(product.category_name || '').toLowerCase() === 'fallback') issues.push('fallback_category');
  return issues;
}

export function isRealCoupangProduct(product = {}) {
  return realProductIssues(product).length === 0;
}

export function decorateProductQuality(product = {}) {
  const qualityIssues = realProductIssues(product);
  return {
    ...product,
    is_real_product: qualityIssues.length === 0,
    quality_issues: qualityIssues
  };
}
