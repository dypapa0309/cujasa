import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createAccount } from '../services/accountService.js';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from '../services/supabaseService.js';

const BLOG_SLUG = 'muckmuck';
const BLOG_URL = 'https://blog.jasain.kr/a/muckmuck';
const START_DATE = '2026-03-12';
const END_DATE = '2026-05-24';

const SOURCE_ACCOUNTS = [
  { key: 'truckman', id: '288ba529-3ba3-4846-9255-7886276b354a', name: '트럭맨', focus: '자취 생활과 실용템' },
  { key: 'mucknunda', id: '3f8f2eb1-bfe3-4105-ac2d-edb7038f0321', name: '먹는다', focus: '음식, 디저트, 간편식' },
  { key: 'dango', id: '59882c05-38e0-4d2d-bd56-2f6b2a9bb6b8', name: '당고', focus: '주방, 청소, 수납' }
];

const FORMATS = [
  { key: 'checklist', label: '체크리스트', title: '사기 전 체크할 것', intro: '바로 결제하기 전에 사용 장면을 먼저 떠올리면 실패 확률이 줄어듭니다.' },
  { key: 'compare', label: '비교형', title: '비슷한 상품 고르는 기준', intro: '상품명이 비슷해도 실제로는 크기, 관리 방식, 놓을 공간에서 차이가 납니다.' },
  { key: 'routine', label: '루틴형', title: '하루 루틴에 넣기 좋은 구성', intro: '좋은 물건은 따로 챙기지 않아도 자주 손이 가는 위치에 있을 때 빛납니다.' },
  { key: 'problem', label: '문제해결형', title: '불편함을 줄이는 현실적인 방법', intro: '작은 불편이 반복되면 생활 만족도가 꽤 떨어집니다. 먼저 문제를 좁혀보는 게 좋습니다.' },
  { key: 'review', label: '후기형', title: '구매 전 살펴볼 포인트', intro: '상세페이지보다 중요한 건 내 공간과 생활 패턴에 맞는지입니다.' },
  { key: 'season', label: '상황형', title: '요즘 쓰기 좋은 선택지', intro: '계절과 일정에 따라 필요한 물건도 조금씩 달라집니다.' }
];

const TITLE_BANK = {
  truckman: [
    '자취방 정리, 큰돈 쓰기 전에 먼저 볼 것들',
    '작은 방에서 생활감 줄이는 수납 기준',
    '자취 시작할 때 오래 쓰는 생활템 고르는 법',
    '책상과 바닥이 금방 어질러질 때 정리 루틴',
    '원룸 생활을 덜 답답하게 만드는 실용템 체크',
    '청소와 정리를 미루지 않게 만드는 물건들'
  ],
  mucknunda: [
    '집에서 챙기기 쉬운 신선식품 고르는 법',
    '과일 선물세트 고를 때 놓치기 쉬운 기준',
    '간단한 한 끼를 준비할 때 먼저 보는 것들',
    '샐러드와 채소를 끝까지 먹기 위한 보관 팁',
    '가볍게 먹고 싶을 때 장바구니에 넣을 만한 식품',
    '디저트와 간식, 실패를 줄이는 선택 기준'
  ],
  dango: [
    '주방 수납이 자꾸 무너질 때 보는 체크리스트',
    '싱크대 주변을 덜 지저분하게 쓰는 방법',
    '청소 도구를 사기 전에 확인할 현실 기준',
    '팬트리와 냉장고 정리를 같이 생각해야 하는 이유',
    '매일 쓰는 주방용품, 관리 쉬운 쪽으로 고르는 법',
    '좁은 주방에서 동선을 줄이는 수납 아이디어'
  ]
};

const TITLE_VARIANTS = [
  '입문 체크',
  '작은 공간 기준',
  '장바구니 정리',
  '관리 포인트',
  '후기 확인법'
];

const FOOD_FALLBACK_PRODUCTS = [
  {
    product_name: '상온 보관 간편식 모음',
    category_name: '간편식',
    product_url: 'https://www.coupang.com/np/search?q=%EA%B0%84%ED%8E%B8%EC%8B%9D',
    partner_url: 'https://www.coupang.com/np/search?q=%EA%B0%84%ED%8E%B8%EC%8B%9D',
    product_price: null
  },
  {
    product_name: '디저트 선물세트 검색',
    category_name: '디저트',
    product_url: 'https://www.coupang.com/np/search?q=%EB%94%94%EC%A0%80%ED%8A%B8%20%EC%84%A0%EB%AC%BC%EC%84%B8%ED%8A%B8',
    partner_url: 'https://www.coupang.com/np/search?q=%EB%94%94%EC%A0%80%ED%8A%B8%20%EC%84%A0%EB%AC%BC%EC%84%B8%ED%8A%B8',
    product_price: null
  },
  {
    product_name: '음식 냄새 관리용 주방 소모품',
    category_name: '주방소모품',
    product_url: 'https://www.coupang.com/np/search?q=%EC%9D%8C%EC%8B%9D%EB%83%84%EC%83%88%20%EC%A0%9C%EA%B1%B0',
    partner_url: 'https://www.coupang.com/np/search?q=%EC%9D%8C%EC%8B%9D%EB%83%84%EC%83%88%20%EC%A0%9C%EA%B1%B0',
    product_price: null
  }
];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dateRange(start, end) {
  const dates = [];
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const last = new Date(Date.UTC(endYear, endMonth - 1, endDay));
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function kstPublishIso(date) {
  return new Date(`${date}T09:15:00+09:00`).toISOString();
}

function compactSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

function priceText(product) {
  const price = Number(product?.product_price);
  return Number.isFinite(price) && price > 0 ? `${price.toLocaleString('ko-KR')}원대` : '가격 변동 가능';
}

function productLink(product) {
  return product?.partner_url || product?.product_url || '';
}

function simplifyProductName(value = '') {
  return String(value || '추천 상품')
    .replace(/\[[^\]]+\]\s*/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .split(',')
    .slice(0, 2)
    .join(',')
    .trim()
    .slice(0, 52);
}

function isFoodProduct(product) {
  const text = `${product?.product_name || ''} ${product?.keyword || ''} ${product?.category_name || ''}`;
  const allow = /식품|로켓프레시|과일|채소|샐러드|쌈|디저트|간식|시리얼|젤리|고기|반찬|간편식|음식|푸드/i.test(text);
  const block = /다우니|섬유|스프레이|욕실|하수구|트랩|배수구|탈취|청소|수납|브러쉬|밀대|정리함/i.test(text);
  return allow && !block;
}

function productUseCase(product, source) {
  const text = `${product?.product_name || ''} ${product?.keyword || ''}`;
  if (source.key === 'mucknunda') {
    if (/과일|선물/i.test(text)) return '선물용이나 손님 맞이용으로 구성과 신선도를 같이 볼 때';
    if (/채소|샐러드|상추|양배추/i.test(text)) return '가벼운 식사나 곁들임 반찬을 자주 준비할 때';
    if (/간식|디저트|젤리|시리얼/i.test(text)) return '집에 두고 조금씩 꺼내 먹을 간식을 찾을 때';
    return '식사 준비를 간단하게 만들고 싶을 때';
  }
  if (source.key === 'dango') {
    if (/수납|정리|박스|바스켓|서랍/i.test(text)) return '물건이 한곳에 쌓여 찾는 시간이 길어질 때';
    if (/싱크|배수|주방/i.test(text)) return '싱크대 주변 물기와 잔여물을 자주 정리해야 할 때';
    if (/청소|밀대|솔|세척/i.test(text)) return '청소 도구를 꺼내기 귀찮아서 미루게 될 때';
    return '주방과 생활공간의 관리 동선을 줄이고 싶을 때';
  }
  if (/청소|브러쉬|먼지|털/i.test(text)) return '바닥이나 패브릭에 먼지와 털이 자주 보일 때';
  if (/수납|정리|박스|바스켓|오거나이저/i.test(text)) return '책상, 옷장, 팬트리의 물건이 자꾸 섞일 때';
  if (/가전|충전|조명/i.test(text)) return '원룸에서 자주 쓰는 기능을 한 번에 해결하고 싶을 때';
  return '자취방에서 자주 겪는 작은 불편을 줄이고 싶을 때';
}

function rotate(array, index, count) {
  if (!array.length) return [];
  return Array.from({ length: Math.min(count, array.length) }, (_, offset) => array[(index + offset) % array.length]);
}

function buildProductCards(products, source) {
  return products.map((product) => {
    const link = productLink(product);
    const name = escapeHtml(simplifyProductName(product.product_name || product.keyword || '추천 상품'));
    const category = escapeHtml(product.category_name || '생활 추천');
    const useCase = escapeHtml(productUseCase(product, source));
    const image = product.product_image
      ? `<img src="${escapeHtml(product.product_image)}" alt="${name}" loading="lazy" referrerpolicy="no-referrer" style="width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid #eee;background:#f7f7f7;">`
      : '';
    const title = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="nofollow sponsored noopener">${name}</a>`
      : name;
    return `
      <li style="display:flex;gap:14px;align-items:flex-start;margin:0 0 16px;padding:14px;border:1px solid #eee;border-radius:12px;background:#fff;">
        ${image}
        <div>
          <strong>${title}</strong>
          <p style="margin:6px 0 0;color:#666;font-size:14px;">${category} · ${escapeHtml(priceText(product))}</p>
          <p style="margin:6px 0 0;color:#444;font-size:14px;">${useCase}</p>
        </div>
      </li>`;
  }).join('');
}

function topicFor(accountData, index) {
  if (!accountData.topics.length) return null;
  return accountData.topics[index % accountData.topics.length];
}

function topicTheme(topic, source) {
  const keyword = Array.isArray(topic?.search_keywords) ? topic.search_keywords[0] : '';
  return String(keyword || topic?.title || source.focus)
    .replace(`${source.name} `, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function titleFor({ source, format, date, index, sourceOrdinal }) {
  const month = Number(date.slice(5, 7));
  const bank = TITLE_BANK[source.key] || TITLE_BANK.truckman;
  const base = bank[sourceOrdinal % bank.length];
  const variant = TITLE_VARIANTS[Math.floor(sourceOrdinal / bank.length) % TITLE_VARIANTS.length];
  if (format.key === 'season') return `${month}월에 다시 보는 ${base}: ${variant}`;
  return `${base}: ${variant}`;
}

function formatSpecificAdvice(format, source) {
  if (format.key === 'compare') {
    return [
      '가격만 비교하면 구성품, 용량, 보관 방식 같은 차이를 놓치기 쉽습니다.',
      '비슷한 상품 2~3개를 볼 때는 사용 빈도, 관리 난이도, 놓을 공간을 같은 기준으로 비교하는 편이 좋습니다.'
    ];
  }
  if (format.key === 'checklist') {
    return [
      '구매 전에는 크기, 보관 위치, 교체 주기, 사용 후 관리 방법을 먼저 확인해보세요.',
      '사진상으로 좋아 보여도 실제 생활 동선에 들어오지 않으면 금방 방치됩니다.'
    ];
  }
  if (format.key === 'routine') {
    return [
      '루틴에 들어갈 물건은 눈에 잘 보이고 손이 닿는 곳에 있어야 합니다.',
      '처음부터 완벽하게 정리하려 하기보다 가장 자주 쓰는 한두 가지부터 바꾸는 것이 오래 갑니다.'
    ];
  }
  if (format.key === 'problem') {
    return [
      '불편함을 줄이려면 먼저 문제가 생기는 순간을 좁혀야 합니다.',
      `${source.focus}에서는 "언제 귀찮아지는지"를 기준으로 상품을 고르면 후회가 적습니다.`
    ];
  }
  return [
    '요즘 필요한 상품인지 판단하려면 계절, 보관 공간, 가족 구성, 사용 빈도를 같이 봐야 합니다.',
    '같은 카테고리라도 지금 생활에 바로 들어오는 쪽을 고르는 것이 좋습니다.'
  ];
}

function bodyFor({ source, format, topic, products, date }) {
  const productNames = products.map((p) => p.product_name || p.keyword).filter(Boolean);
  const focusLine = topic?.angle || topic?.reason || `${source.focus} 관점에서 실제로 자주 쓰일 만한 기준을 정리했습니다.`;
  const keywordLine = Array.isArray(topic?.search_keywords) && topic.search_keywords.length
    ? topic.search_keywords.slice(0, 4).join(', ')
    : productNames.slice(0, 3).join(', ');
  const cards = buildProductCards(products, source);
  const advice = formatSpecificAdvice(format, source);
  const theme = topicTheme(topic, source);

  return `
    <p style="margin:0 0 18px;padding:12px 14px;border:1px solid #f2d5b8;border-radius:10px;background:#fff8f0;color:#6b3b12;font-size:13px;line-height:1.6;">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>
    <p><strong>${escapeHtml(date)}</strong> 기준으로 ${escapeHtml(source.focus)}에 맞는 상품과 검색 흐름을 다시 정리했습니다. ${escapeHtml(format.intro)}</p>
    <p>이번 글의 핵심은 <strong>${escapeHtml(theme)}</strong>입니다. 상품을 먼저 나열하기보다, 실제로 어디서 쓰고 어떤 불편을 줄일 수 있는지부터 보는 방식으로 정리했습니다.</p>
    <h2>먼저 생각할 상황</h2>
    <p>${escapeHtml(focusLine)}</p>
    <p>${escapeHtml(advice[0])} ${escapeHtml(advice[1])}</p>
    <h2>고르는 기준</h2>
    <ul>
      <li><strong>사용 빈도</strong>: 매일 쓰는 물건은 접근성이 중요하고, 가끔 쓰는 물건은 보관성이 더 중요합니다.</li>
      <li><strong>관리 난이도</strong>: 세척, 충전, 분리수거, 냉장 보관처럼 반복되는 일을 감당할 수 있는지 봐야 합니다.</li>
      <li><strong>공간 적합성</strong>: 원룸, 주방, 냉장고, 팬트리처럼 실제 둘 자리가 정해져 있어야 오래 씁니다.</li>
      <li><strong>구성 대비 가격</strong>: 단품 가격보다 용량, 개수, 배송 조건, 교체 주기를 같이 보는 편이 정확합니다.</li>
    </ul>
    <h2>장바구니 후보</h2>
    <ul style="list-style:none;padding:0;margin:18px 0;">${cards}</ul>
    <h2>구매 전에 한 번 더 볼 부분</h2>
    <p>${escapeHtml(source.focus)}에 관심이 있고, 검색어를 너무 넓게 잡기보다 <strong>${escapeHtml(keywordLine || source.focus)}</strong>처럼 실제 상황 기준으로 좁혀보고 싶은 분에게 맞습니다.</p>
    <p>후기에서는 별점만 보지 말고 낮은 평점의 이유를 먼저 확인해보세요. 사이즈가 생각보다 크다거나, 포장이 약하다거나, 세척이 번거롭다는 내용은 내 생활에서도 그대로 문제가 될 수 있습니다.</p>
    <h2>정리</h2>
    <p>이번 큐레이션은 "좋아 보이는 상품"보다 "내 생활에 들어올 수 있는 상품"을 기준으로 골라보는 데 초점을 뒀습니다. 필요한 상황이 분명할수록 장바구니에서 덜 흔들립니다.</p>
    <p>단, 같은 상품이라도 가격과 구성은 수시로 바뀔 수 있으니 구매 전 옵션, 배송 조건, 최신 후기를 다시 확인하는 것이 좋습니다.</p>
    <p style="font-size:13px;color:#777;">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>
  `;
}

function metaDescriptionFor(source, format, topic) {
  const theme = topicTheme(topic, source);
  const formatNotes = {
    checklist: '구매 전에 확인할 기준만 짧게 추렸습니다.',
    compare: '비슷한 후보를 비교할 때 볼 기준을 정리했습니다.',
    routine: '생활 루틴에 자연스럽게 넣을 수 있는 기준을 담았습니다.',
    problem: '불편한 지점을 줄이는 방향으로 장바구니를 정리했습니다.',
    review: '후기에서 먼저 봐야 할 포인트를 중심으로 정리했습니다.',
    season: '요즘 쓰기 좋은 선택 기준을 다시 훑었습니다.'
  };
  return `${theme} 선택에서 놓치기 쉬운 부분과 ${source.focus} 기준의 포인트를 정리했습니다. ${formatNotes[format.key] || '필요한 기준만 담았습니다.'}`;
}

async function ensureBlogAccount(projectId) {
  const existing = await dbGet('accounts', { blog_slug: BLOG_SLUG });
  const now = new Date().toISOString();
  const patch = {
    name: 'muckmuck',
    account_handle: '@muckmuck',
    content_scope: '트럭맨, 먹는다, 당고 계정의 쿠팡 상품 큐레이션',
    blog_enabled: true,
    blog_slug: BLOG_SLUG,
    blog_title: 'muckmuck',
    blog_public_url: BLOG_URL,
    blog_base_url: BLOG_URL,
    blog_created_at: existing?.blog_created_at || now,
    blog_auto_publish_enabled: false,
    blog_publish_mode: 'manual',
    status: 'active',
    automation_status: 'paused',
    updated_at: now
  };

  if (existing) {
    const [updated] = await dbUpdate('accounts', { id: existing.id }, patch);
    return updated || { ...existing, ...patch };
  }

  const created = await createAccount({
    project_id: projectId,
    name: 'muckmuck',
    platform: 'blog',
    account_handle: '@muckmuck',
    target_audience: '자취, 푸드, 주방 정리 상품을 찾는 독자',
    content_scope: '트럭맨, 먹는다, 당고 계정의 쿠팡 상품 큐레이션',
    tone: '실용적이고 편한 한국어 블로그 톤',
    cta_style: '자연스러운 추천'
  });
  const [updated] = await dbUpdate('accounts', { id: created.id }, patch);
  return updated || { ...created, ...patch };
}

async function loadSourceData() {
  const accountIds = SOURCE_ACCOUNTS.map((account) => account.id);
  const [products, topics] = await Promise.all([
    dbList('coupang_products', {}, {
      in: { account_id: accountIds },
      order: 'created_at',
      ascending: true,
      limit: 1000
    }),
    dbList('topics', {}, {
      in: { account_id: accountIds },
      order: 'created_at',
      ascending: true,
      limit: 1000
    })
  ]);

  return Object.fromEntries(SOURCE_ACCOUNTS.map((source) => {
    const allSourceProducts = products
      .filter((product) => product.account_id === source.id)
      .filter((product) => product.product_name || product.keyword)
      .sort((a, b) => Number(a.is_fallback) - Number(b.is_fallback));
    const realProducts = allSourceProducts.filter((product) => !product.is_fallback);
    const sourceProducts = source.key === 'mucknunda'
      ? realProducts.filter(isFoodProduct)
      : realProducts.length ? realProducts : allSourceProducts;
    const sourceTopics = topics.filter((topic) => topic.account_id === source.id);
    const finalProducts = sourceProducts.length ? sourceProducts : FOOD_FALLBACK_PRODUCTS;
    return [source.key, { source, products: finalProducts, topics: sourceTopics }];
  }));
}

async function main() {
  const projects = await dbList('projects', {}, { order: 'created_at', ascending: true, limit: 1 });
  const projectId = projects[0]?.id || randomUUID();
  const account = await ensureBlogAccount(projectId);
  const dataBySource = await loadSourceData();
  const dates = dateRange(START_DATE, END_DATE);
  if (process.argv.includes('--reset')) {
    await dbDelete('blog_posts', { account_id: account.id });
  }
  const existingPosts = await dbList('blog_posts', { account_id: account.id }, { select: 'slug' });
  const existingSlugs = new Set(existingPosts.map((post) => post.slug));

  const rows = dates.map((date, index) => {
    const source = SOURCE_ACCOUNTS[index % SOURCE_ACCOUNTS.length];
    const accountData = dataBySource[source.key];
    const sourceOrdinal = Math.floor(index / SOURCE_ACCOUNTS.length);
    const format = FORMATS[(sourceOrdinal + SOURCE_ACCOUNTS.findIndex((item) => item.key === source.key) * 2) % FORMATS.length];
    const topic = topicFor(accountData, index);
    const products = rotate(accountData.products, index * 2, 3);
    const slug = `muckmuck-${date}-${source.key}-${format.key}`;
    const title = titleFor({ source, format, date, index, sourceOrdinal });
    const content = bodyFor({ source, format, topic, products, date });
    return {
      account_id: account.id,
      topic_id: topic?.id || null,
      slug: compactSlug(slug),
      title,
      meta_description: metaDescriptionFor(source, format, topic),
      content,
      cover_image_url: products.find((product) => product.product_image)?.product_image || '',
      tags: [source.name, source.focus, format.label, '쿠팡 상품 큐레이션'].filter(Boolean),
      seo_keywords: [source.name, source.focus, topic?.title, ...(topic?.search_keywords || []), ...products.map((p) => p.product_name).filter(Boolean).slice(0, 3)].filter(Boolean).slice(0, 12),
      status: 'published',
      published_at: kstPublishIso(date, index),
      created_at: kstPublishIso(date, index),
      updated_at: new Date().toISOString()
    };
  }).filter((row) => !existingSlugs.has(row.slug));

  if (rows.length) {
    for (let index = 0; index < rows.length; index += 25) {
      await dbInsert('blog_posts', rows.slice(index, index + 25));
    }
  }

  const allPosts = await dbList('blog_posts', { account_id: account.id, status: 'published' }, {
    order: 'published_at',
    ascending: true,
    limit: 1000
  });
  console.log(JSON.stringify({
    blogUrl: BLOG_URL,
    accountId: account.id,
    inserted: rows.length,
    totalPublished: allPosts.length,
    firstPublishedAt: allPosts[0]?.published_at || null,
    lastPublishedAt: allPosts.at(-1)?.published_at || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
