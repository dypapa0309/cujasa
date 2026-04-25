import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { generateCtaPrompt } from '../prompts/generateCtaPrompt.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';

export async function generateCtas(postId) {
  const post = await dbGet('posts', { id: postId });
  const account = await getAccount(post.account_id);
  const fallback = {
    ctas: [
      { variantKey: 'A', ctaText: '물어보는 분 있을 것 같아서 제가 찾아본 제품은 댓글에 남겨둘게요.' },
      { variantKey: 'B', ctaText: '비슷한 걸 찾는다면 이쪽 키워드로 보면 됩니다.' },
      { variantKey: 'C', ctaText: '가격은 자주 바뀌니까 최저가 위주로 보시면 됩니다.' }
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
