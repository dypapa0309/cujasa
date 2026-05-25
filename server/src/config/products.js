export const JASAIN_BRAND = {
  id: 'jasain',
  name: 'JASAIN',
  domain: 'jasain.kr',
  storeUrl: 'https://store.jasain.kr',
  apiUrl: 'https://api.jasain.kr'
};

export const PRODUCTS = [
  {
    id: 'cujasa',
    name: 'CUJASA',
    description: '쿠팡 파트너스 자동화 콘솔',
    supportLabel: '쿠팡 파트너스 자동화',
    appUrl: 'https://app.jasain.kr',
    legacyAppUrl: 'https://cujasa.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/cujasa',
    status: 'active'
  },
  {
    id: 'dexor',
    name: 'DEXOR',
    description: '블로그 분석 및 선정 자동화',
    supportLabel: '블로그 분석 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/dexor',
    status: 'active'
  },
  {
    id: 'spread',
    name: 'SPREAD',
    description: '추천 캠페인 운영 자동화',
    supportLabel: '캠페인 운영 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/spread',
    status: 'active'
  },
  {
    id: 'polibot',
    name: 'POLIBOT',
    description: '보험 보장분석 및 상품 추천 자동화',
    supportLabel: '보험 분석 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/polibot',
    status: 'active'
  },
  {
    id: 'infludex',
    name: 'INFLUDEX',
    description: '인스타그램 인플루언서 등급 분석',
    supportLabel: '인스타그램 분석 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/infludex',
    status: 'active'
  },
  {
    id: 'sublog',
    name: 'SUBLOG',
    description: '구독 비용 관리',
    supportLabel: '구독 비용 관리',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/sublog',
    status: 'active'
  },
  {
    id: 'auvibot',
    name: 'AUVIBOT',
    description: '상품 쇼츠 생산 자동화',
    supportLabel: '상품 영상 자동화',
    appUrl: 'https://app.jasain.kr',
    landingUrl: 'https://store.jasain.kr/store/auvibot',
    status: 'active'
  }
];

export const DEFAULT_PRODUCT_ID = 'cujasa';

export function productById(productId) {
  return PRODUCTS.find((product) => product.id === productId) || null;
}
