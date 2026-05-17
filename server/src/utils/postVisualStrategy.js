function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableBucket(seed = '', modulo = 100) {
  const text = String(seed || '');
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return modulo ? hash % modulo : 0;
}

function clampRatio(value, fallback = 0.35) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function imageRatioForAccount(account = {}) {
  return clampRatio(
    account.image_post_ratio
      ?? account.visual_post_ratio
      ?? process.env.CUJASA_IMAGE_POST_RATIO,
    0.35
  );
}

function recentVisualStats(recentPosts = []) {
  const recent = recentPosts.slice(0, 6);
  const visualCount = recent.filter((post) => post?.metadata?.visualPlan?.attachImage).length;
  let consecutiveVisuals = 0;
  for (const post of recent) {
    if (!post?.metadata?.visualPlan?.attachImage) break;
    consecutiveVisuals += 1;
  }
  return { recentCount: recent.length, visualCount, consecutiveVisuals };
}

export function classifyContentBridge(body = '', contentType = '') {
  const text = normalizeText(`${contentType} ${body}`);
  if (/checklist_card/.test(text)) return 'checklist_card';
  if (/meme_caption|visual_card_caption|room_reality|before_after|fake_chat|send_to_friend|tiny_confession|pov_scene|myth_reality|photo_dump_caption|series_note/.test(text)) return 'meme_card';
  if (/anti_buy|wrong_purchase|anti_aesthetic|before_buy_check/.test(text)) return 'anti_recommendation';
  if (/collection_bridge/.test(text)) return 'collection_bridge';
  if (/체크|리스트|1\.\s|□|살 때 보면 안 되는|봐야 하는|1순위|2순위|우선순위|ranked_list/.test(text)) return 'checklist_card';
  if (/ㅋㅋ|나만|현실|상상|전\s*[:：]|후\s*[:：]|정리 전|정리 후|짤|밈|POV|pov|사진첩|포토덤프/.test(text)) return 'meme_card';
  if (/사지 말|후회|실패|잘못 사|돈만|애매/.test(text)) return 'anti_recommendation';
  if (/모아|기준|먼저 봐|고를 때/.test(text)) return 'collection_bridge';
  return 'ambient_text';
}

function visualPromptForRole(role, { body = '', topic = {}, products = [] } = {}) {
  const productHint = products
    .map((product) => product.product_name || product.name || product.keyword || product.category_name)
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
  const topicHint = normalizeText(`${topic.title || ''} ${topic.angle || ''}`) || productHint || '생활 공감';
  const firstLine = String(body || '').split(/\n/).map((line) => line.trim()).find(Boolean) || topicHint;
  const prompts = {
    checklist_card: `Korean social card, clean checklist layout, no brand logos, topic: ${topicHint}, headline inspired by: ${firstLine}`,
    meme_card: `Korean relatable meme-style text card, simple two-panel before/after layout, no copyrighted characters, topic: ${topicHint}, caption idea: ${firstLine}`,
    anti_recommendation: `Korean caution card for shopping regret prevention, plain room/lifestyle context, no brand logos, topic: ${topicHint}`,
    collection_bridge: `Korean save-worthy social card, practical criteria layout, lifestyle context, no product ad styling, topic: ${topicHint}`,
    ambient_text: `Korean everyday lifestyle image card, subtle text overlay, no brand logos, topic: ${topicHint}`
  };
  return prompts[role] || prompts.ambient_text;
}

export function buildPostVisualPlan({
  post = {},
  topic = {},
  account = {},
  products = [],
  recentPosts = []
} = {}) {
  const ratio = imageRatioForAccount(account);
  const stats = recentVisualStats(recentPosts);
  const seed = `${account.id || ''}:${topic.id || ''}:${post.id || ''}:${post.contentType || post.content_type || ''}:${post.body || ''}`;
  const role = classifyContentBridge(post.body, `${post.contentFormat || post.content_format || ''} ${post.contentType || post.content_type || ''}`);
  const forcedTextOnly = /텍스트만|이미지\s*금지|사진\s*금지/.test(String(account.content_style_note || ''));
  const tooManyRecent = stats.recentCount >= 3 && (stats.visualCount / stats.recentCount) >= Math.max(0.5, ratio + 0.2);
  const attachImage = !forcedTextOnly
    && ratio > 0
    && stats.consecutiveVisuals < 2
    && !tooManyRecent
    && stableBucket(seed, 100) < Math.round(ratio * 100);
  const primaryProductImage = products.find((product) => /^https?:\/\//i.test(String(product.product_image || product.image || '')));
  const useProductImage = attachImage
    && role === 'collection_bridge'
    && primaryProductImage
    && stableBucket(`${seed}:product-image`, 100) < 20;

  return {
    attachImage,
    imageRatio: ratio,
    imageCaptionRole: attachImage ? (role === 'collection_bridge' && useProductImage ? 'context' : 'hook') : 'none',
    imageSourceType: attachImage
      ? (useProductImage ? 'product_image' : 'generated_card')
      : 'none',
    imageRisk: attachImage
      ? (useProductImage ? 'medium' : 'low')
      : 'none',
    imageRole: role,
    imageUrl: useProductImage ? (primaryProductImage.product_image || primaryProductImage.image) : '',
    imagePrompt: attachImage && !useProductImage ? visualPromptForRole(role, { body: post.body, topic, products }) : '',
    policy: attachImage
      ? '본문은 일반 포스팅처럼 유지하고, 링크/제휴 고지는 업로드 댓글 레이어에서 처리합니다.'
      : '텍스트 전용 포스트입니다.',
    recentVisualCount: stats.visualCount,
    recentVisualWindow: stats.recentCount,
    consecutiveVisuals: stats.consecutiveVisuals
  };
}
