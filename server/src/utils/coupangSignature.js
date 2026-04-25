import crypto from 'node:crypto';

export function createCoupangSignedDate(date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

export function createCoupangSignatureMessage(signedDate, method, pathWithQuery) {
  const [path, query = ''] = pathWithQuery.split('?');
  return signedDate + method.toUpperCase() + path + query;
}

export function createCoupangAuthorization(method, pathWithQuery) {
  const signedDate = createCoupangSignedDate();
  const message = createCoupangSignatureMessage(signedDate, method, pathWithQuery);
  const signature = crypto.createHmac('sha256', process.env.COUPANG_SECRET_KEY || '').update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${process.env.COUPANG_ACCESS_KEY || ''}, signed-date=${signedDate}, signature=${signature}`;
}
