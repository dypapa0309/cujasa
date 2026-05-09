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
        rules: [
          'Generate exactly 5 candidate posts for this topic. The service will score them and save only the best one.',
          'Never include account names, login IDs, Threads handles, or @handles in the post body.',
          'Prioritize comments/replies over pure information density.',
          'Write like a specific person noticing a small real situation, not like an AI summarizing pros and cons.',
          'Avoid template openings such as "이건 은근 기준이 갈리는 선택", "사람마다 다르더라고요", and generic "실용성 vs 사용감" questions unless the words are tied to a concrete scene.',
          'Every candidate needs at least one concrete daily detail: where it happens, what is annoying, when it gets noticed, or what changes after choosing.',
          'Prefer the stable CUJASA shape when it fits: one lived-in opening, one short "막상 써보면/살아보면" observation, 2-3 concrete criteria, then one easy experience question.',
          'For 자취/원룸/살림 topics, concrete criteria should sound like actual spots or chores: 설거지 후 둘 곳, 빨래 모아둘 곳, 욕실 물기, 조리대 위 자리, 꺼내기 쉬운 구조.',
          'Default to safe choice-tension frames: A/B choice, criteria that split opinions, "people who tried this" questions, and situation-based preferences.',
          referencePatterns.length
            ? 'Use referencePatterns as strong structural and voice inspiration. Never copy exact source wording, but mirror the pacing, line breaks, list shape, punctuation habits, tone register, hook pattern, question pattern, and tension type.'
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
          'Avoid formal AI-ish connective phrases such as "중요합니다", "도움이 됩니다", "고려해야 합니다", "선택하는 것이 좋습니다", unless the account tone explicitly asks for expert writing.',
          'Do not write balanced essay paragraphs. Use short lived-in observations, slightly uneven rhythm, and natural Korean phrasing.',
          referencePatterns.length
            ? 'When mirroring a list pattern, write short subjective one-line observations with new labels and new details. End with one light comment prompt only.'
            : 'Avoid long explanations.',
          'Every post should make the reader able to answer in under 5 seconds.',
          'When returning multiple posts, distribute contentType across the allowed contentTypes instead of using one type repeatedly.',
          accountProfile.strategy.effectiveMode === 'auto'
            ? 'Because content mode is AUTO, choose the best content type per candidate from the allowed contentTypes. Do not force one format for all candidates.'
            : 'Respect the selected structured content mode.',
          'Use varied angles: one can be empathy, one checklist, one problem-solution, one question, or one mistake-prevention when allowed.',
          'Optimize the body for saves, replies, and shares: concrete inconvenience, quick recognition, or a useful tiny insight should lead.',
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
