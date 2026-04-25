import 'dotenv/config';
import { searchKeyword } from '../services/coupangService.js';
import { createCoupangSignedDate } from '../utils/coupangSignature.js';

const keyword = process.argv[2] || '탈취제';

const required = ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Coupang API test');
console.log(`keyword: ${keyword}`);
console.log(`signedDate sample: ${createCoupangSignedDate()}`);
console.log(`subId configured: ${Boolean(process.env.COUPANG_TRACKING_CODE)}`);

const products = await searchKeyword(keyword, 5);
const realProducts = products.filter((product) => !product.is_fallback);

console.log(`received: ${products.length}`);
console.log(`real api products: ${realProducts.length}`);
console.log(`fallback products: ${products.length - realProducts.length}`);

products.slice(0, 3).forEach((product, index) => {
  console.log(`${index + 1}. ${product.product_name} | fallback=${product.is_fallback} | price=${product.product_price ?? '-'}`);
});

if (!realProducts.length) {
  console.error('No real Coupang API products received. Check activity_logs for coupang_fallback details.');
  process.exit(2);
}
