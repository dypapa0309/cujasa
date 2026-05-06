export const SUPPORT_QA_VERSION = '2026-05-06';

export const supportQaTree = {
  title: 'JASAIN 상담',
  subtitle: '궁금한 내용을 선택해 주세요.',
  welcome: '안녕하세요. JASAIN 자동 상담입니다. 필요한 내용을 고르면 빠르게 안내해드릴게요.',
  nodes: {
    root: {
      title: '무엇을 도와드릴까요?',
      options: [
        { label: 'CUJASA 문의', next: 'cujasa' },
        { label: 'DEXOR 문의', next: 'dexor' },
        { label: '가격/결제 문의', next: 'pricing' },
        { label: '도입 절차', next: 'onboarding' },
        { label: '오류/세팅 문의', next: 'setup' },
        { label: '전화 상담', next: 'phone' }
      ]
    },
    cujasa: {
      title: 'CUJASA 문의',
      body: 'CUJASA는 쿠팡 파트너스 상품 검색, 콘텐츠 생성, Threads 예약 업로드를 운영하는 자동화 도구입니다.',
      options: [
        { label: '쿠팡 링크는 어떻게 붙나요?', next: 'cujasa-links' },
        { label: 'Threads 자동 포스팅 방식', next: 'cujasa-threads' },
        { label: '계정 제한이 걱정돼요', next: 'cujasa-safety' },
        { label: '실상품 링크 필요가 뭔가요?', next: 'cujasa-real-products' },
        { label: '상담 신청하기', action: 'inquiry', topic: 'cujasa' }
      ]
    },
    'cujasa-links': {
      title: '쿠팡 링크는 어떻게 붙나요?',
      body: '실제 쿠팡 API에서 가져온 상품만 링크 글에 연결합니다. 검색 실패 임시상품이나 검색 URL은 수익화 링크로 사용하지 않습니다.',
      options: [
        { label: '상품 검색/연결 상담', action: 'inquiry', topic: 'cujasa_links' },
        { label: 'CUJASA 바로가기', action: 'link', href: 'https://cujasa.jasain.kr' }
      ]
    },
    'cujasa-threads': {
      title: 'Threads 자동 포스팅 방식',
      body: '계정 연결 후 주제와 상품을 준비하고, 예약 시간에 Threads 본문에 콘텐츠와 링크를 포함해 업로드합니다.',
      options: [
        { label: '도입 상담 남기기', action: 'inquiry', topic: 'cujasa_threads' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    'cujasa-safety': {
      title: '계정 제한이 걱정돼요',
      body: '쿠팡 검색은 계정 단위 간격 제한과 쿨다운을 적용하고, 링크가 불확실하면 자동화를 성공처럼 처리하지 않습니다.',
      options: [
        { label: '안전 운영 상담', action: 'inquiry', topic: 'cujasa_safety' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    'cujasa-real-products': {
      title: '실상품 링크 필요 안내',
      body: '링크 글 비율이 켜져 있는데 실제 쿠팡 상품이 선택되지 않으면 자동화를 막습니다. 상품 추천 결과에서 실상품을 먼저 검색하고 연결해야 합니다.',
      options: [
        { label: '실상품 연결 도움받기', action: 'inquiry', topic: 'real_product_links' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    dexor: {
      title: 'DEXOR 문의',
      body: 'DEXOR는 블로그 분석, 키워드 발굴, 콘텐츠 선정 업무를 도와주는 자동화 서비스입니다.',
      options: [
        { label: '블로그 분석 자동화', next: 'dexor-analysis' },
        { label: '키워드/콘텐츠 선정', next: 'dexor-keywords' },
        { label: 'DEXOR 바로가기', action: 'link', href: 'https://dexor-pearl.vercel.app/' },
        { label: '상담 신청하기', action: 'inquiry', topic: 'dexor' }
      ]
    },
    'dexor-analysis': {
      title: '블로그 분석 자동화',
      body: '반복적인 블로그 데이터 확인과 선정 과정을 줄이고, 운영자가 판단하기 쉬운 형태로 정리하는 데 초점을 둡니다.',
      options: [
        { label: 'DEXOR 도입 상담', action: 'inquiry', topic: 'dexor_analysis' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    'dexor-keywords': {
      title: '키워드/콘텐츠 선정',
      body: '키워드 후보와 콘텐츠 방향성을 정리해 반복 작업 시간을 줄이는 방향으로 사용할 수 있습니다.',
      options: [
        { label: '키워드 상담 남기기', action: 'inquiry', topic: 'dexor_keywords' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    pricing: {
      title: '가격/결제 문의',
      body: '서비스별 가격과 결제 방식은 도입 범위에 따라 안내드립니다. 일시불, 월정액, 세팅 지원 여부를 함께 확인합니다.',
      options: [
        { label: '가격 상담 남기기', action: 'inquiry', topic: 'pricing' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    onboarding: {
      title: '도입 절차',
      body: '상담 후 계정/결제/초기 세팅을 확인하고, 운영 가능 상태를 검증한 뒤 자동화를 시작합니다.',
      options: [
        { label: '도입 상담 신청', action: 'inquiry', topic: 'onboarding' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    setup: {
      title: '오류/세팅 문의',
      body: 'Threads 연결, 쿠팡 파트너스 키, 실상품 검색, 결제/권한 문제를 확인해드립니다.',
      options: [
        { label: '세팅 도움 요청', action: 'inquiry', topic: 'setup' },
        { label: '전화 상담하기', action: 'phone' }
      ]
    },
    phone: {
      title: '전화 상담',
      body: '바로 통화가 필요하면 전화상담하기를 눌러주세요. 통화가 어려우면 문의를 남겨주시면 확인 후 연락드립니다.',
      options: [
        { label: '전화상담하기', action: 'phone' },
        { label: '문의 남기기', action: 'inquiry', topic: 'phone_request' }
      ]
    }
  }
};

export function publicSupportConfig() {
  return {
    version: SUPPORT_QA_VERSION,
    ...supportQaTree,
    phone: {
      display: process.env.SUPPORT_PHONE_DISPLAY || '전화 상담',
      tel: process.env.SUPPORT_PHONE_TEL || ''
    },
    products: {
      jasain: 'JASAIN',
      cujasa: 'CUJASA',
      dexor: 'DEXOR'
    }
  };
}
