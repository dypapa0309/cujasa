import { getJson } from './openaiService.js';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { generateBlogPrompt } from '../prompts/generateBlogPrompt.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

function isMissingSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return ['42703', '42P01'].includes(error?.code)
    || message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find');
}

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

function toBlogSlug(value) {
  const base = String(value || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return base || `blog-${Date.now().toString(36)}`;
}

async function uniqueBlogSlug(account) {
  const seed = account?.account_handle || account?.name || account?.id || 'blog';
  const base = toBlogSlug(seed);
  const candidates = [
    base,
    `${base}-${String(account?.id || '').slice(0, 6)}`,
    `${base}-${Date.now().toString(36)}`
  ].filter(Boolean);
  for (const candidate of candidates) {
    const existing = (await dbList('accounts', { blog_slug: candidate }).catch(() => []))[0];
    if (!existing || existing.id === account.id) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function publicBlogUrl(slug) {
  return `${APP_BASE_URL}/blog/a/${encodeURIComponent(slug)}`;
}

export async function ensureAccountBlog(accountId) {
  const account = await dbGet('accounts', { id: accountId });
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  if (account.status !== 'active') {
    const error = new Error('활성 계정만 자체 블로그를 생성할 수 있습니다.');
    error.status = 409;
    throw error;
  }
  if (account.blog_enabled && account.blog_slug && account.blog_public_url) return account;

  const blogSlug = account.blog_slug || await uniqueBlogSlug(account);
  const blogTitle = account.blog_title || `${account.name || account.account_handle || 'JASAIN'} 블로그`;
  const now = new Date().toISOString();
  try {
    const [updated] = await dbUpdate('accounts', { id: account.id }, {
      blog_enabled: true,
      blog_slug: blogSlug,
      blog_title: blogTitle,
      blog_public_url: publicBlogUrl(blogSlug),
      blog_created_at: account.blog_created_at || now,
      blog_base_url: account.blog_base_url || publicBlogUrl(blogSlug),
      updated_at: now
    });
    return updated;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      const nextError = new Error('자체 블로그 DB 설정이 아직 적용되지 않았습니다. 마이그레이션 적용 후 다시 시도해 주세요.');
      nextError.status = 503;
      nextError.code = 'BLOG_SCHEMA_NOT_READY';
      throw nextError;
    }
    throw error;
  }
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
  if (!account?.blog_enabled || !account?.blog_auto_publish_enabled) return null;
  const productionAllowed = account.blog_publish_mode === 'auto' || process.env.BLOG_AUTO_PUBLISH_IN_PRODUCTION === 'true';
  if (process.env.NODE_ENV === 'production' && !productionAllowed) return null;
  if (!post?.topic_id || !queue?.id) return null;
  return generateBlogPostForTopic(post.topic_id, {
    queueId: queue.id,
    postId: post.id,
    account
  });
}

export async function listBlogPosts({ limit = 20, offset = 0 } = {}) {
  const all = await dbList('blog_posts', { status: 'published' }, {
    lte: { published_at: new Date().toISOString() },
    order: 'published_at',
    ascending: false
  });
  return all.slice(offset, offset + limit);
}

export async function getBlogPost(slug) {
  const all = await dbList('blog_posts', { slug, status: 'published' }, {
    lte: { published_at: new Date().toISOString() }
  });
  return all[0] || null;
}

export async function getAccountBlog(blogSlug) {
  const all = await dbList('accounts', { blog_slug: blogSlug });
  return all.find((account) => account.blog_enabled && account.status === 'active') || null;
}

export async function listAccountBlogPosts(blogSlug, { limit = 20, offset = 0 } = {}) {
  const account = await getAccountBlog(blogSlug);
  if (!account) return { account: null, posts: [] };
  const all = await dbList('blog_posts', { account_id: account.id, status: 'published' }, {
    lte: { published_at: new Date().toISOString() },
    order: 'published_at',
    ascending: false
  });
  return { account, posts: all.slice(offset, offset + limit) };
}

export async function getAccountBlogPost(blogSlug, postSlug) {
  const account = await getAccountBlog(blogSlug);
  if (!account) return { account: null, post: null };
  const all = await dbList('blog_posts', { account_id: account.id, slug: postSlug, status: 'published' }, {
    lte: { published_at: new Date().toISOString() }
  });
  return { account, post: all[0] || null };
}
