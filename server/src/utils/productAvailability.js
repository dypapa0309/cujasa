export function productServiceClosedInProduction(productId) {
  if (process.env.NODE_ENV !== 'production') return false;
  if (productId === 'infludex') return process.env.INFLUDEX_SERVICE_OPEN === 'false';
  return false;
}

export function productMaintenancePayload(productId) {
  const productName = productId === 'infludex' ? 'INFLUDEX' : 'SPREAD';
  return {
    error: `${productName}_SERVICE_MAINTENANCE`,
    message: `${productName}는 현재 서비스 점검 중입니다.`
  };
}

export function throwIfProductServiceClosed(productId) {
  if (!productServiceClosedInProduction(productId)) return;
  const payload = productMaintenancePayload(productId);
  const error = new Error(payload.message);
  error.status = 503;
  error.code = payload.error;
  throw error;
}
