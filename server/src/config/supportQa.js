export const SUPPORT_QA_VERSION = '2026-05-07';

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
        { label: 'SPREAD 문의', next: 'spread' },
        { label: '상담 연결', next: 'phone' }
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
        { label: 'JASAIN 워크스페이스 열기', action: 'link', href: 'https://app.jasain.kr/?mode=register&product=cujasa#tab=beta' }
      ]
    },
    'cujasa-threads': {
      title: 'Threads 자동 포스팅 방식',
      body: '계정 연결 후 주제와 상품을 준비하고, 예약 시간에 Threads 본문에 콘텐츠와 링크를 포함해 업로드합니다.',
      options: [
        { label: '도입 상담 남기기', action: 'inquiry', topic: 'cujasa_threads' },
        { label: '문의 남기기', action: 'inquiry', topic: 'cujasa_threads' }
      ]
    },
    'cujasa-safety': {
      title: '계정 제한이 걱정돼요',
      body: '쿠팡 검색은 계정 단위 간격 제한과 쿨다운을 적용하고, 링크가 불확실하면 자동화를 성공처럼 처리하지 않습니다.',
      options: [
        { label: '안전 운영 상담', action: 'inquiry', topic: 'cujasa_safety' },
        { label: '문의 남기기', action: 'inquiry', topic: 'cujasa_safety' }
      ]
    },
    'cujasa-real-products': {
      title: '실상품 링크 필요 안내',
      body: '링크 글 비율이 켜져 있는데 실제 쿠팡 상품이 선택되지 않으면 자동화를 막습니다. 상품 추천 결과에서 실상품을 먼저 검색하고 연결해야 합니다.',
      options: [
        { label: '실상품 연결 도움받기', action: 'inquiry', topic: 'real_product_links' },
        { label: '문의 남기기', action: 'inquiry', topic: 'real_product_links' }
      ]
    },
    dexor: {
      title: 'DEXOR 문의',
      body: 'DEXOR는 블로그 분석, 키워드 발굴, 콘텐츠 선정 업무를 도와주는 자동화 서비스입니다.',
      options: [
        { label: '블로그 분석 자동화', next: 'dexor-analysis' },
        { label: '키워드/콘텐츠 선정', next: 'dexor-keywords' },
        { label: 'DEXOR 시작하기', action: 'link', href: 'https://app.jasain.kr/?mode=register&product=dexor#tab=beta' },
        { label: '상담 신청하기', action: 'inquiry', topic: 'dexor' }
      ]
    },
    spread: {
      title: 'SPREAD 문의',
      body: 'SPREAD는 추천 캠페인, 신청자 선정, 제출물 검수를 한 흐름으로 운영하는 자동화 서비스입니다.',
      options: [
        { label: 'SPREAD 시작하기', action: 'link', href: 'https://app.jasain.kr/?mode=register&product=spread#tab=beta' },
        { label: '상담 신청하기', action: 'inquiry', topic: 'spread' }
      ]
    },
    'dexor-analysis': {
      title: '블로그 분석 자동화',
      body: '반복적인 블로그 데이터 확인과 선정 과정을 줄이고, 운영자가 판단하기 쉬운 형태로 정리하는 데 초점을 둡니다.',
      options: [
        { label: 'DEXOR 도입 상담', action: 'inquiry', topic: 'dexor_analysis' },
        { label: '문의 남기기', action: 'inquiry', topic: 'dexor_analysis' }
      ]
    },
    'dexor-keywords': {
      title: '키워드/콘텐츠 선정',
      body: '키워드 후보와 콘텐츠 방향성을 정리해 반복 작업 시간을 줄이는 방향으로 사용할 수 있습니다.',
      options: [
        { label: '키워드 상담 남기기', action: 'inquiry', topic: 'dexor_keywords' },
        { label: '문의 남기기', action: 'inquiry', topic: 'dexor_keywords' }
      ]
    },
    pricing: {
      title: '가격/결제 문의',
      body: '서비스별 가격과 결제 방식은 도입 범위에 따라 안내드립니다. 일시불, 월정액, 세팅 지원 여부를 함께 확인합니다.',
      options: [
        { label: '가격 상담 남기기', action: 'inquiry', topic: 'pricing' },
        { label: '문의 남기기', action: 'inquiry', topic: 'pricing' }
      ]
    },
    onboarding: {
      title: '도입 절차',
      body: '상담 후 계정/결제/초기 세팅을 확인하고, 운영 가능 상태를 검증한 뒤 자동화를 시작합니다.',
      options: [
        { label: '도입 상담 신청', action: 'inquiry', topic: 'onboarding' },
        { label: '문의 남기기', action: 'inquiry', topic: 'onboarding' }
      ]
    },
    setup: {
      title: '오류/세팅 문의',
      body: 'Threads 연결, 쿠팡 파트너스 키, 실상품 검색, 결제/권한 문제를 확인해드립니다.',
      options: [
        { label: '세팅 도움 요청', action: 'inquiry', topic: 'setup' },
        { label: '문의 남기기', action: 'inquiry', topic: 'setup' }
      ]
    },
    phone: {
      title: '상담 연결',
      body: '문자 또는 카카오톡으로 바로 상담할 수 있습니다.',
      options: [
        { label: '문자상담하기', action: 'phone' },
        { label: '카카오톡 상담하기', action: 'link', href: 'https://open.kakao.com/o/sOtaVlsi' },
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
      display: process.env.SUPPORT_PHONE_DISPLAY || '문자 상담 010-7541-6143',
      tel: process.env.SUPPORT_PHONE_TEL || '01075416143'
    },
    products: {
      jasain: 'JASAIN',
      cujasa: 'CUJASA',
      dexor: 'DEXOR',
      spread: 'SPREAD'
    }
  };
}
