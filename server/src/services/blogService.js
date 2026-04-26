import { getJson } from './openaiService.js';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { generateBlogPrompt } from '../prompts/generateBlogPrompt.js';

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
  const topic = await dbGet('topics', { id: topicId });
  const postProducts = await dbList('post_products', { topic_id: topicId });
  const products = await Promise.all(
    postProducts.map((pp) => dbGet('coupang_products', { id: pp.product_id }))
  );
  const validProducts = products.filter(Boolean);

  const fallback = {
    title: topic.title,
    metaDescription: `${topic.title}에 대해 알아보고 추천 상품을 확인해보세요.`,
    content: `<h2>${topic.title}</h2><p>${topic.angle}</p>`
  };

  const result = await getJson(generateBlogPrompt(topic, validProducts), fallback);

  return dbInsert('blog_posts', {
    account_id: topic.account_id,
    topic_id: topicId,
    slug: toSlug(result.title || topic.title),
    title: result.title || topic.title,
    meta_description: result.metaDescription || fallback.metaDescription,
    content: result.content || fallback.content,
    status: 'published',
    published_at: new Date().toISOString()
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
