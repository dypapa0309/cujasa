export const JASAIN_BRAND = {
  id: 'jasain',
  name: 'JASAIN',
  domain: 'jasain.kr'
};

export const PRODUCTS = [
  {
    id: 'cujasa',
    name: 'CUJASA',
    description: '쿠팡 파트너스 자동화 콘솔',
    supportLabel: '쿠팡 파트너스 자동화',
    appUrl: 'https://app.jasain.kr',
    legacyAppUrl: 'https://cujasa.jasain.kr',
    landingUrl: 'https://jasain.kr/cujasa'
  },
  {
    id: 'dexor',
    name: 'DEXOR',
    description: '블로그 분석 및 선정 자동화',
    supportLabel: '블로그 선정 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://jasain.kr/dexor'
  },
  {
    id: 'spread',
    name: 'SPREAD',
    description: '추천 캠페인 운영 자동화',
    supportLabel: '캠페인 운영 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://jasain.kr'
  }
];

export const CURRENT_PRODUCT = PRODUCTS[0];

export function productById(productId) {
  return PRODUCTS.find((product) => product.id === productId) || null;
}
