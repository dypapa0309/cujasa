import { getJson } from './openaiService.js';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { generateBlogPrompt } from '../prompts/generateBlogPrompt.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

function sanitizeHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:/gi, '');
}

function toSlug(title) {
  const map = { ' ': '-', '(': '', ')': '', '[': '', ']': '', '/': '-', '?': '', '!': '', ',': '', '.': '', ':': '', "'": '', '"': '' };
  return title
    .replace(/[^가-힣a-zA-Z0-9\s\-_]/g, (c) => map[c] ?? '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80)
    + '-' + Date.now().toString(36);
}

export async function generateBlogPost(topicId) {
  return generateBlogPostForTopic(topicId);
}

export async function generateBlogPostForTopic(topicId, { queueId = null, postId = null, account = null } = {}) {
  if (queueId) {
    const existing = await dbGet('blog_posts', { queue_id: queueId }).catch(() => null);
    if (existing) return existing;
  }
  if (postId) {
    const existing = await dbGet('blog_posts', { post_id: postId }).catch(() => null);
    if (existing) return existing;
  }
  const topic = await dbGet('topics', { id: topicId });
  const postProducts = await dbList('post_products', { topic_id: topicId });
  const products = await Promise.all(
    postProducts.map((pp) => dbGet('coupang_products', { id: pp.product_id }))
  );
  const validProducts = products.filter(isRealCoupangProduct);

  const fallback = {
    title: topic.title,
    metaDescription: `${topic.title}에 대해 알아보고 추천 상품을 확인해보세요.`,
    content: `<h2>${topic.title}</h2><p>${topic.angle}</p>`
  };

  const result = await getJson(generateBlogPrompt(topic, validProducts), fallback);

  return dbInsert('blog_posts', {
    account_id: topic.account_id,
    topic_id: topicId,
    post_id: postId,
    queue_id: queueId,
    slug: toSlug(result.title || topic.title),
    title: result.title || topic.title,
    meta_description: result.metaDescription || fallback.metaDescription,
    content: sanitizeHtml(result.content || fallback.content),
    cover_image_url: process.env.BLOG_IMAGE_URL || '',
    tags: [topic.title, topic.target_user, account?.content_scope].filter(Boolean).slice(0, 8),
    seo_keywords: [topic.title, ...(topic.search_keywords || []), account?.content_scope].filter(Boolean).slice(0, 12),
    status: 'published',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
}

export async function maybeGenerateBlogPostForQueue({ account, post, queue } = {}) {
  if (!account?.blog_auto_publish_enabled) return null;
  if (process.env.NODE_ENV === 'production') return null;
  if (!post?.topic_id || !queue?.id) return null;
  return generateBlogPostForTopic(post.topic_id, {
    queueId: queue.id,
    postId: post.id,
    account
  });
}

export async function listBlogPosts({ limit = 20, offset = 0 } = {}) {
  const all = await dbList('blog_posts', { status: 'published' }, { order: 'published_at', ascending: false });
  return all.slice(offset, offset + limit);
}

export async function getBlogPost(slug) {
  const all = await dbList('blog_posts', { slug });
  return all[0] || null;
}
