import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { generateCtaPrompt } from '../prompts/generateCtaPrompt.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';

export async function generateCtas(postId) {
  const post = await dbGet('posts', { id: postId });
  const account = await getAccount(post.account_id);
  const fallback = {
    ctas: [
      { variantKey: 'A', ctaText: '비슷한 걸 고를 때 참고만 해보세요.' },
      { variantKey: 'B', ctaText: '취향이나 상황에 맞게 비교해보면 좋아요.' },
      { variantKey: 'C', ctaText: '필요한 분들만 가볍게 확인해보세요.' }
    ]
  };
  const result = await getJson(generateCtaPrompt(post, account), fallback);
  const rows = [];
  for (const cta of (result.ctas || fallback.ctas).slice(0, 3)) {
    rows.push(await dbInsert('cta_variants', {
      post_id: postId,
      account_id: post.account_id,
      cta_text: cta.ctaText,
      variant_key: cta.variantKey,
      status: 'active'
    }));
  }
  return rows;
}

export const listCtas = (postId) => dbList('cta_variants', { post_id: postId });
