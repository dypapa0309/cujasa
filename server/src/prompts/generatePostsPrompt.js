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
          referencePatternMix: account.referencePatternMix || null,
          contentDiversityPlan: account.contentDiversityPlan || null
        },
        performanceSignals: performanceSignals ? {
          topTopics: performanceSignals.topTopics || [],
          topProducts: performanceSignals.topProducts || [],
          topProductGroups: performanceSignals.topProductGroups || [],
          topPosts: performanceSignals.topPosts || [],
          topContentFormats: performanceSignals.topContentFormats || [],
          topContentGoals: performanceSignals.topContentGoals || [],
          topLengthBuckets: performanceSignals.topLengthBuckets || []
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
          defaultEngagementPattern: 'normal-content-first safe choice-tension',
          priority: 'Make the body read like a normal standalone Threads post first. Link and disclosure are handled later in a reply by the upload layer.',
          contentGoals: ['reach_only', 'reply', 'save', 'conversion', 'trust', 'experiment', 'share', 'meme', 'rant', 'confession', 'anti_buy', 'seasonal_spike', 'curiosity', 'community'],
          contentFormats: ['plain_observation', 'daily_one_liner', 'two_line_empathy', 'random_life_complaint', 'fake_chat', 'before_after', 'meme_caption', 'anti_buy', 'checklist_card', 'mini_story', 'choice_question', 'soft_question', 'collection_bridge', 'direct_product', 'seasonal_life', 'trend_reaction', 'send_to_friend', 'tiny_confession', 'wrong_purchase', 'before_buy_check', 'room_reality', 'lazy_person_tip', 'anti_aesthetic', 'mini_poll', 'micro_story', 'visual_card_caption', 'pov_scene', 'myth_reality', 'ranked_list', 'imaginary_reply', 'series_note', 'photo_dump_caption']
        },
        contentDiversityPlan: account.contentDiversityPlan || null,
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
          'At least 1 candidate may be very short, 1-2 lines only, if it works as a relatable one-liner, meme-caption, or quick complaint.',
          'At least 1 candidate should hide the product/category until the second half by leading with a daily situation, relatable failure, meme-card caption, or checklist premise.',
          'At least 1 candidate should optimize for share or meme value, such as send_to_friend, tiny_confession, room_reality, wrong_purchase, visual_card_caption, pov_scene, myth_reality, or photo_dump_caption.',
          'At least 1 candidate should optimize for save or anti-buy value, such as before_buy_check, anti_buy, wrong_purchase, anti_aesthetic, or checklist_card.',
          'At least 1 candidate should use a native social shape that is not a direct recommendation: POV, 생각/현실, 짧은 우선순위, or a reply-to-an-imaginary-comment shape.',
          'Do not make all 5 candidates reply questions. Mix reach-only, share/meme, save, and conversion goals.',
          account.contentDiversityPlan
            ? 'Follow contentDiversityPlan strongly: include at least 1 candidate matching primarySlot, at least 2 candidates matching different secondarySlots, and avoid making every candidate the same length.'
            : 'No contentDiversityPlan is available, so still vary length, goal, and format.',
          account.contentDiversityPlan?.candidateBlueprints
            ? 'Use contentDiversityPlan.candidateBlueprints as the role map for candidates 1-5. Candidate i should follow blueprint i for slotKey, preferredGoal, one preferredFormat, targetLengthBucket, revealMode, and questionMode.'
            : 'No candidateBlueprints are available, so create your own 5-way mix of format, length, reveal mode, and question mode.',
          'Reveal modes: situation_first means start from a daily scene before naming the item; item_late means mention the item/category only after the hook; no_item_name means body can stay as a normal relatable post without naming the exact item if the scene is clear; criteria_first means lead with a practical standard.',
          'Question modes: no_question means do not end with a question; optional_soft_question means one light question is allowed but not required; may_end_with_question means a natural reply prompt is allowed. Across all 5 candidates, use at most 2 question endings.',
          'Do not write disclosure, affiliate wording, Coupang, link, CTA, profile-link, or purchase instructions in the body. The upload system attaches any required disclosure and Coupang link as a reply later.',
          'Do not mention comments as a place to check information. Never write "댓글 참고", "댓글 확인", "댓글 봐", "댓글 달아", or similar CTA language.',
          'Do not copy the topic title into the first sentence. If the topic title sounds like a keyword list, turn it into a concrete scene instead.',
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
          performanceSignals?.topContentFormats?.length
            ? 'Prefer proven high-click content formats from performanceSignals.topContentFormats when they fit the contentDiversityPlan, but still avoid repeating the same format too many times in a row.'
            : 'No reliable high-click format mix is available yet.',
          performanceSignals?.topProducts?.length
            ? 'When selectedProducts overlap with high-click product groups, make the use situation clearer without sounding more ad-like.'
            : 'Do not claim historical performance without signals.',
          referencePatterns.length
            ? 'If a reference pattern uses raw list-style observations, keep that raw Threads feel. Avoid formal explanatory phrases such as "경향이 있습니다", "영향을 미칩니다", or "특징이 있습니다".'
            : 'Keep the tone conversational and not essay-like.',
          'Never use awkward or formal phrases: "흐름이에요", "흐름이야", "생활 속에서", "중요합니다", "도움이 됩니다", "고려해야 합니다", "선택하는 것이 좋습니다".',
          'Do not use over-written metaphors or fake-deep punchlines such as "집이 좁은 게 아니라 내가 물건을 너무 믿었음", "청소는 인생 개조 프로젝트", "방이 나를 거부함", or "물건이 나를 이김". Korean internet tone should sound like a real quick complaint, not a copywriter line.',
          'Prefer action-based Korean such as "다시 두기 편한지", "손이 덜 가는지", "자주 꺼내기 쉬운지", "놔둘 자리가 있는지".',
          'Do not write balanced essay paragraphs. Use short lived-in observations, slightly uneven rhythm, and natural Korean phrasing.',
          'Avoid topic-title echo sentences such as "홈인테리어,주방용품,소형 생활가전 정리 쉽게 하는 법, 평소에는 별거 아닌데..." because real users do not write keyword titles into posts.',
          'Product-first openings are optional, not mandatory. Often prefer situation-first openings that still remain clear: "좁은 방 정리하려고 수납장 샀는데 방이 더 좁아짐 ㅋㅋ" is clearer than "수납하려고 샀는데 방이 더 좁아지는 거 진짜 있음".',
          'Avoid unclear compressed sentences where the object is missing, such as "청소는 꺼내는 시간이 길면 시작도 안 하게 됨" or "수납하려고 샀는데 방이 더 좁아지는 거 진짜 있음". If the item is not named, the situation must still make the object obvious.',
          'Good normal-content-first formats: daily_confession, relatable_fail, meme_card_caption, checklist_card, anti_recommendation, collection_bridge, direct_product. Use direct_product sparingly.',
          'Expanded viral-safe formats: send_to_friend ("택배 박스 못 버리는 사람한테 보내야 됨"), tiny_confession ("정리함 사놓고 정리함 안에 넣을 물건을 못 정함"), wrong_purchase ("선반 샀는데 선반 둘 자리가 없었음"), lazy_person_tip ("다시 넣기 귀찮은 사람 기준으로 봐야 됨"), anti_aesthetic ("감성보다 동선이 오래 감"), mini_poll ("투명 수납함 vs 안 보이는 수납함 여기서 갈림"), micro_story ("방 치우려고 일어남. 봉투 찾음. 다시 누움."), visual_card_caption ("정리 전: 수납함 사면 끝 / 정리 후: 수납함 둘 자리 찾는 중"), pov_scene ("POV: 방 치우려고 일어났는데 충전선이 발에 걸림"), myth_reality ("생각: 수납함 사면 끝 / 현실: 수납함 둘 자리부터 찾음"), ranked_list ("원룸 정리템 볼 때 1순위는 예쁨 말고 바닥 안 막는지"), imaginary_reply ("댓글에서 정리함 뭐 보냐고 물어보면 난 깊이보다 둘 자리부터 봄"), series_note ("요즘 방 정리 메모 1. 큰 거 하나보다 작은 거 두 개가 나을 때 있음").',
          'Short posts are allowed. Examples of acceptable shape: "좁은 방 정리하려고 수납장 샀는데 방이 더 좁아짐 ㅋㅋ", "멀티탭 정리함 샀는데 정리함이 제일 큼", "먼지 보여도 돌돌이 안 보이면 그냥 못 본 척함", "청소하려고 일어났는데 물티슈 찾다가 다시 누움".',
          'For plain reach-only posts, prefer literal small moments over clever abstractions: "신발 박스 못 버리는 사람 이해 안감", "방 치우려고 봉투 찾다가 의욕 사라짐", "정리함 사기 전에 정리함 둘 자리부터 봐야 됨".',
          'Do not pad every post into 3 paragraphs. Some candidates should be one-liners, some two lines, some checklist/card style, and some longer practical posts.',
          'For meme/card-style candidates, write the body as if a separate image card could carry the hook, but do not reference an attached image explicitly.',
          'Avoid survey-like endings such as "여러분은 뭐였어요?", "뭐부터 보세요?", "쓰는 순간부터 보세요?". Prefer internet-native prompts like "이거 나만 신경 쓰이나?", "다들 뭐부터 봄?", "이 정도면 예민한 거임?", "써본 사람 공감함?" when the account uses banmal, and lighter polite variants when it does not.',
          'Internet-native Korean is allowed when safe: short fragments, "듯", "많음", "은근", "진짜", "나만", "공감함?", "여기서 갈림" are okay. Do not overdo slang, insults, identity conflict, or hostile bait.',
          referencePatterns.length
            ? 'When mirroring a list pattern, write short subjective one-line observations with new labels and new details. End with one light comment prompt only.'
            : 'Avoid long explanations.',
          referencePatterns.length
            ? 'Use analysisProfile.bestFor to match the topic and selectedProducts. Avoid any pattern whose analysisProfile.avoidFor conflicts with the topic, account, or product category.'
            : 'Do not invent external trend evidence.',
          'Every post should make the reader able to answer in under 5 seconds.',
          'When returning multiple posts, distribute contentType across the allowed contentTypes instead of using one type repeatedly.',
          'Return contentFormat and contentGoal for every candidate. Use only values from generationGoal.contentFormats and generationGoal.contentGoals.',
          'Format-goal match: reach_only uses plain_observation/daily_one_liner/two_line_empathy/micro_story; share uses send_to_friend; meme uses meme_caption/room_reality/visual_card_caption/fake_chat/before_after/pov_scene/myth_reality/photo_dump_caption; rant uses random_life_complaint/lazy_person_tip; confession uses tiny_confession; reply uses soft_question/choice_question/mini_poll/two_line_empathy; save uses checklist_card/before_buy_check/ranked_list; anti_buy uses anti_buy/wrong_purchase/anti_aesthetic; conversion uses collection_bridge/direct_product; seasonal_spike uses seasonal_life/trend_reaction; trust uses mini_story/plain_observation; curiosity uses series_note; community uses imaginary_reply.',
          'Do not make all candidates the same length. Include one short reach_only/share/meme candidate and one save/anti_buy/conversion candidate when the topic allows it.',
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
          'Do not mention links, profile links, prices, cheapest price, Coupang, affiliate disclosure, or where to buy in the post body. You may ask a natural experience or choice question.',
          'The post body must read like a normal standalone Threads post. CTA, link, Coupang URL, and required disclosure are attached later during upload, usually as a reply.',
          'Never write phrases like "아래 링크 확인", "자세한 건 링크", "댓글 확인", "최저가", or "할인 정보".',
          'For kitchen, cleaning, home, or homemaking accounts, write like a short natural Threads post, not a blog article.',
          'Avoid long numbered checklists unless the topic explicitly demands a checklist.',
          'Prefer concise conversational writing. Length can vary from 1 line to 5 short sentences depending on the format.',
          'Strong first sentence',
          'Short sentences',
          'Minimize ad tone',
          accountProfile.strategy.productMentionStyle === 'none' ? 'Do not use product names.' : 'Do not overuse product names',
          'Avoid 100%, 무조건, 완벽, 보장, 치료, 예방',
          ...accountProfile.rules
        ],
        contentTypes: accountProfile.strategy.allowedContentTypes,
        schema: { posts: [{ contentType: 'string', contentFormat: 'string', contentGoal: 'string', body: 'string', styleChecklist: ['string'], riskLevel: 'low | medium | high' }] }
      })
    }
  ];
}
