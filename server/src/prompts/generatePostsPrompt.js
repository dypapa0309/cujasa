import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function generatePostsPrompt(topic, products, account) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = getAccountStyleProfile(account);
  const referencePatterns = Array.isArray(account.referencePatterns) ? account.referencePatterns : [];
  const performanceSignals = account.performanceSignals || null;
  return [
    { role: 'system', content: 'You write short, natural Korean Threads posts. Return strict JSON only. Account tone is a style guide, not a keyword checklist. Natural readability comes first.' },
    {
      role: 'user',
      content: JSON.stringify({
        contentContext,
        accountProfile,
        account: {
          tone: account.tone,
          ctaStyle: account.cta_style,
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words,
          contentStrategy: accountProfile.strategy,
          referencePatternMix: account.referencePatternMix || null
        },
        performanceSignals: performanceSignals ? {
          topTopics: performanceSignals.topTopics || [],
          topProducts: performanceSignals.topProducts || [],
          topProductGroups: performanceSignals.topProductGroups || [],
          topPosts: performanceSignals.topPosts || []
        } : null,
        referencePatterns: referencePatterns.map((pattern) => ({
          hookPattern: pattern.hookPattern,
          commentQuestion: pattern.commentQuestion,
          tensionType: pattern.tensionType,
          emotionSignal: pattern.emotionSignal,
          reusableStructure: pattern.reusableStructure,
          voicePattern: pattern.voicePattern,
          formatPattern: pattern.formatPattern,
          lineBreakPattern: pattern.lineBreakPattern,
          listStructure: pattern.listStructure,
          punctuationStyle: pattern.punctuationStyle,
          toneRegister: pattern.toneRegister,
          performanceScore: pattern.performanceScore,
          qualityScore: pattern.qualityScore,
          analysisProfile: pattern.analysisProfile,
          sourceType: pattern.sourceType || 'anonymous_pattern'
        })),
        topic,
        selectedProducts: products.map((p) => ({
          name: p.product_name,
          category: p.category_name,
          price: p.product_price,
          keyword: p.keyword,
          reason: p.recommendation_reason
        })),
        generationGoal: {
          primaryMetric: 'comments_and_replies',
          candidateCount: 5,
          defaultEngagementPattern: 'safe choice-tension',
          priority: 'Make readers want to answer with their own preference or experience.'
        },
        speechRegister: /반말|존댓말\s*금지/.test(String(account.tone || '').replace(/\s+/g, ''))
          ? {
            mode: 'banmal',
            rule: 'Use banmal only. Do not use 요, 죠, 네요, 세요, 입니다, 합니다, 됩니다, 이에요, 예요 endings anywhere.'
          }
          : {
            mode: 'polite_conversational',
            rule: 'Use one consistent polite conversational register. Prefer 해요체/죠/더라고요/같아요. Do not mix in banmal endings like 해, 했어, 같아, 뭐였어.'
          },
        rules: [
          'Generate exactly 5 candidate posts for this topic. The service will score them and save only the best one.',
          'At least 2 candidates must be useful lived-in information posts, not just reply-bait questions.',
          'At least 1 candidate should use a regret-prevention frame and at least 1 should use an experience-question frame when safe.',
          'Never include account names, login IDs, Threads handles, or @handles in the post body.',
          'Prioritize save-worthy lived-in usefulness first, then comments/replies. A reader should learn one tiny practical standard.',
          'Write like a specific person noticing a small real situation, not like an AI summarizing pros and cons.',
          /반말|존댓말\s*금지/.test(String(account.tone || '').replace(/\s+/g, ''))
            ? 'Speech register hard rule: banmal only. Never mix polite endings into a banmal account.'
            : 'Speech register hard rule: polite conversational Korean only. Never mix banmal endings into a polite account.',
          'Do not mix 반말 and 존댓말 in the same post. If unsure, use polite conversational 해요체 unless speechRegister.mode is banmal.',
          'Avoid template openings such as "이건 은근 기준이 갈리는 선택", "사람마다 다르더라고요", "작은 기준 하나만 정해도", and generic "실용성 vs 사용감" questions.',
          'Every candidate needs at least one concrete daily detail: where it happens, what is annoying, when it gets noticed, or what changes after choosing.',
          'Strong candidates include small physical details: 현관에서 바로 집는 물건, 설거지 후 둘 자리, 욕실 물기, 빨래 전 바구니, 침대 옆 충전기, 분리수거 봉투처럼 a real spot or chore.',
          'Weak candidates only say broad criteria like "자주 쓰는지, 보관이 쉬운지, 관리가 부담 없는지"; do not submit those unless each criterion has a concrete scene.',
          'A good post should feel like "I wish someone told me this before my first week living alone", not a shopping list.',
          'Mix formats naturally. Numbered posts are allowed, but do not make every candidate 1-2-3. Also submit prose, comparison, and experience-question shapes when they fit.',
          'When using numbered criteria, each number must contain a lived-in scene, not abstract labels like "자주 쓰는지" or "보관이 쉬운지".',
          'For prose posts, a natural observation such as "A가 애매하면 B가 불편해진다" can pass quality if it contains concrete details.',
          'Use the stable CUJASA shape only when it fits: one lived-in opening, one short "막상 써보면/살아보면" observation, 2-3 concrete criteria, then one easy experience question.',
          'Category detail matching is strict: kitchen uses 조리대/싱크대/설거지/물 빠짐; childcare uses 기저귀/물티슈/장난감/아이 손 닿는 자리; cleaning uses 청소포/먼지/욕실 물기/보관 자리; gift posts should avoid childcare or kitchen chore details.',
          'For 자취/원룸/살림 topics, concrete criteria should sound like actual spots or chores: 설거지 후 둘 곳, 빨래 모아둘 곳, 욕실 물기, 조리대 위 자리, 꺼내기 쉬운 구조.',
          'Default to safe choice-tension frames: A/B choice, criteria that split opinions, "people who tried this" questions, and situation-based preferences.',
          referencePatterns.length
            ? 'Use referencePatterns as strong structural and voice inspiration. Prioritize patterns with high qualityScore and low analysisProfile.templateRisk/aiToneRisk. Never copy exact source wording, but mirror the pacing, line breaks, list shape, punctuation habits, tone register, hook pattern, question pattern, and tension type.'
            : 'No referencePatterns are available, so rely on the safe default engagement frames.',
          performanceSignals?.topPosts?.length
            ? 'Use performanceSignals.topPosts as lightweight evidence of what earned clicks before. Borrow the broad hook/choice structure only; never copy body text.'
            : 'No reliable click-winning post patterns are available yet.',
          performanceSignals?.topProducts?.length
            ? 'When selectedProducts overlap with high-click product groups, make the use situation clearer without sounding more ad-like.'
            : 'Do not claim historical performance without signals.',
          referencePatterns.length
            ? 'If a reference pattern uses raw list-style observations, keep that raw Threads feel. Avoid formal explanatory phrases such as "경향이 있습니다", "영향을 미칩니다", or "특징이 있습니다".'
            : 'Keep the tone conversational and not essay-like.',
          'Never use awkward or formal phrases: "흐름이에요", "흐름이야", "생활 속에서", "중요합니다", "도움이 됩니다", "고려해야 합니다", "선택하는 것이 좋습니다".',
          'Prefer action-based Korean such as "다시 두기 편한지", "손이 덜 가는지", "자주 꺼내기 쉬운지", "놔둘 자리가 있는지".',
          'Do not write balanced essay paragraphs. Use short lived-in observations, slightly uneven rhythm, and natural Korean phrasing.',
          referencePatterns.length
            ? 'When mirroring a list pattern, write short subjective one-line observations with new labels and new details. End with one light comment prompt only.'
            : 'Avoid long explanations.',
          referencePatterns.length
            ? 'Use analysisProfile.bestFor to match the topic and selectedProducts. Avoid any pattern whose analysisProfile.avoidFor conflicts with the topic, account, or product category.'
            : 'Do not invent external trend evidence.',
          'Every post should make the reader able to answer in under 5 seconds.',
          'When returning multiple posts, distribute contentType across the allowed contentTypes instead of using one type repeatedly.',
          accountProfile.strategy.effectiveMode === 'auto'
            ? 'Because content mode is AUTO, choose the best content type per candidate from the allowed contentTypes. Do not force one format for all candidates.'
            : 'Respect the selected structured content mode.',
          'Use varied angles: one can be empathy, one checklist, one problem-solution, one question, or one mistake-prevention when allowed.',
          'Optimize the body for saves, replies, and shares: concrete inconvenience, quick recognition, or a useful tiny insight should lead. Saves matter more than a forced final question.',
          'Use stronger hook frames while staying safe: 나만 불편한 줄 알았던 상황, 은근 갈리는 선택, 사고 나서 후회하는 기준, or a house/life question people can answer immediately.',
          'The first sentence must contain at least one of: a concrete inconvenience, a safe choice tension, a regret-prevention cue, or an easy experience question.',
          'Safe tension is allowed only around taste, habit, space, budget, frequency, and use-case differences.',
          'Never use gender, generation, job, region, politics, body, family status, or identity as the source of tension.',
          'Never create hostile polarization: no insults, contempt, gender/age/job/region conflict, politics, or identity attacks.',
          'Do not make every post a product recommendation. The body should feel like useful Threads content first.',
          accountProfile.strategy.seasonalityEnabled
            ? 'Use currentDateKST and seasonKST as the seasonal context.'
            : 'Do not force seasonal references.',
          'Do not mention off-season winter/cold-wave/thermal/padded/glove/hot-pack themes unless seasonKST is winter.',
          'Do not write diet, supplement, medicine, treatment, prevention, or guaranteed-effect content.',
          'stayWithinContentScope: keep every post inside the account contentScope.',
          'Make the first sentence naturally reflect the target reader and situation.',
          'Write for accountProfile.targetAudience, not a generic reader.',
          'Only use product/category situations inside accountProfile.contentScope.',
          accountProfile.strategy.productMentionStyle === 'none'
            ? 'When selectedProducts exist, use the situation only; do not mention product names or product categories in the body.'
            : 'When selectedProducts exist, make the post situation naturally explain why those product categories solve the reader problem.',
          'Do not list unrelated generic categories. Anchor the post in the selected product use case without sounding like an ad.',
          'If tone contains 후기/review, use review-like observation without pretending actual personal use.',
          'If tone contains 설레/emotional, use subtle anticipation only when it fits. Do not force emotional keywords.',
          'Use natural Korean spacing and line breaks. Avoid awkward machine-translated phrasing.',
          'Prefer warm but plain endings like "덜 후회하더라고요", "먼저 티 나요", "저라면 여기부터 봐요"; avoid stiff endings like "중요합니다" or "도움이 됩니다".',
          'Use zero or one emoji at most. Never decorate every sentence with emoji.',
          'Do not use bland generic phrases if preferredExpressions are provided.',
          'Do not mention links, profile links, prices, cheapest price, or where to buy in the post body. You may ask a natural experience or choice question.',
          'The post body must read like a normal standalone Threads post. CTA, link, and ad disclosure are attached later during upload.',
          'Never write phrases like "아래 링크 확인", "자세한 건 링크", "댓글 확인", "최저가", or "할인 정보".',
          'For kitchen, cleaning, home, or homemaking accounts, write like a short natural Threads post, not a blog article.',
          'Avoid long numbered checklists unless the topic explicitly demands a checklist.',
          'Prefer 2-5 short sentences. Keep the body concise and conversational.',
          'Strong first sentence',
          'Short sentences',
          'Minimize ad tone',
          accountProfile.strategy.productMentionStyle === 'none' ? 'Do not use product names.' : 'Do not overuse product names',
          'Avoid 100%, 무조건, 완벽, 보장, 치료, 예방',
          ...accountProfile.rules
        ],
        contentTypes: accountProfile.strategy.allowedContentTypes,
        schema: { posts: [{ contentType: 'string', body: 'string', styleChecklist: ['string'], riskLevel: 'low | medium | high' }] }
      })
    }
  ];
}
