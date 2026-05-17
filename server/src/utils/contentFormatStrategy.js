const CONTENT_FORMATS = new Set([
  'plain_observation',
  'daily_one_liner',
  'two_line_empathy',
  'random_life_complaint',
  'fake_chat',
  'before_after',
  'meme_caption',
  'anti_buy',
  'checklist_card',
  'mini_story',
  'choice_question',
  'soft_question',
  'collection_bridge',
  'direct_product',
  'seasonal_life',
  'trend_reaction',
  'send_to_friend',
  'tiny_confession',
  'wrong_purchase',
  'before_buy_check',
  'room_reality',
  'lazy_person_tip',
  'anti_aesthetic',
  'mini_poll',
  'micro_story',
  'visual_card_caption',
  'pov_scene',
  'myth_reality',
  'ranked_list',
  'imaginary_reply',
  'series_note',
  'photo_dump_caption'
]);

const CONTENT_GOALS = new Set([
  'reach_only',
  'reply',
  'save',
  'conversion',
  'trust',
  'experiment',
  'share',
  'meme',
  'rant',
  'confession',
  'anti_buy',
  'seasonal_spike',
  'curiosity',
  'community'
]);

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lineCount(body = '') {
  return String(body || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
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

export function normalizeContentFormat(value = '') {
  const key = String(value || '').trim();
  return CONTENT_FORMATS.has(key) ? key : '';
}

export function normalizeContentGoal(value = '') {
  const key = String(value || '').trim();
  return CONTENT_GOALS.has(key) ? key : '';
}

export function inferContentFormat(body = '', contentType = '') {
  const text = normalizeText(body);
  const lines = lineCount(body);
  const type = String(contentType || '');
  if (/^\s*(친구|나|엄마|동생|회사사람|집주인)\s*[:：]/m.test(body)) return 'fake_chat';
  if (/^\s*(POV|pov|관점)\s*[:：]/.test(text) || /(나\s*:\s*|내\s*상태\s*[:：])/.test(text)) return 'pov_scene';
  if (/(^|\n)\s*(정리\s*전|before|Before|전)\s*[:：]/i.test(body) && /(^|\n)\s*(정리\s*후|after|After|후)\s*[:：]/i.test(body)) return 'before_after';
  if (/(생각|상상|기대)\s*[:：].*(현실|실제)\s*[:：]|(현실|실제)\s*[:：].*(생각|상상|기대)\s*[:：]/.test(text)) return 'myth_reality';
  if (/(1위|2위|3위|1순위|2순위|3순위|TOP\s*3|top\s*3|우선순위|먼저\s*보는\s*순서)/i.test(text)) return 'ranked_list';
  if (/(누가|친구가|댓글에서).*(물어보|묻|라고\s*하면|라길래)|^답\s*[:：]/.test(text)) return 'imaginary_reply';
  if (/(오늘의|이번\s*주|요즘\s*기록|시리즈|메모)\s*(정리|기록|메모|노트)|\bpt\.?\s*\d+/i.test(text)) return 'series_note';
  if (/(사진첩|앨범|포토덤프|photo\s*dump|요즘\s*방|요즘\s*책상).*(요약|기록|상태)/i.test(text)) return 'photo_dump_caption';
  if (/(보내야|태그해야|생각남|떠오름|이거\s*너|친구한테|누구\s*생각)/.test(text)) return 'send_to_friend';
  if (/(고백|솔직히|못\s*버림|못\s*버리는|안\s*치움|미룸|사놓고|쌓아둠)/.test(text) && lines <= 2) return 'tiny_confession';
  if (/(샀는데|사고\s*나서|샀다가).*(없었|후회|망함|애매|더\s*좁|안\s*씀|손\s*안\s*감)/.test(text)) return 'wrong_purchase';
  if (/(사기\s*전|고르기\s*전|살\s*때|사기전에|고르기전에).*(먼저|봐야|확인|체크)/.test(text)) return 'before_buy_check';
  if (/(현실|상상|방\s*꼬라지|택배\s*박스|정리\s*전|정리\s*후|바닥에|굴러다님)/.test(text)) return 'room_reality';
  if (/(귀찮|게으른|부지런|다시\s*넣기|꺼내기\s*귀찮|손\s*안\s*감|의욕\s*사라)/.test(text)) return 'lazy_person_tip';
  if (/(감성|예쁜|인테리어|사진빨).*(보다|말고|이김|동선|꺼내기|손\s*가)/.test(text)) return 'anti_aesthetic';
  if (/( vs |VS|둘\s*중|투명.*안\s*보이|보이는.*숨기는|A\/B|ㄱ|ㄴ)/.test(text)) return 'mini_poll';
  if (/체크|리스트|^\s*\d+\.\s+/m.test(body) || /사지 말아야 할|봐야 하는 말|조심해야 하는 말/.test(text) || type.includes('체크')) return 'checklist_card';
  if (/사지 말|사면 안|함정|위험|후회|실패|잘못 사/.test(text)) return 'anti_buy';
  if (/[?？]/.test(text) && /(둘 중|뭐가|어느 쪽|나만|공감|겪어본|다들)/.test(text)) {
    return /(둘 중|어느 쪽| vs |VS)/.test(text) ? 'choice_question' : 'soft_question';
  }
  if (/모아|기준|사기 전|고르기 전|먼저 봐|추천하고 감/.test(text)) return 'collection_bridge';
  if (lines === 1 && text.length <= 55) return 'daily_one_liner';
  if (lines <= 2 && text.length <= 95 && /(ㅋㅋ|나만|은근|그냥|못 본 척|의욕|이해 안감|안감|누움|사라짐|왜 이럼|뭐임)/.test(text)) return 'two_line_empathy';
  if (lines <= 3 && /(귀찮|의욕|못 버리|안 치우|미루|누움|사라짐|이해 안감|안감)/.test(text)) return 'random_life_complaint';
  if (lines <= 2 && /(짤|밈|현실|상상|ㅋㅋ)/.test(text)) return 'meme_caption';
  if (lines <= 2 && /(카드|짤|밈|현실|상상|정리\s*전|정리\s*후|ㅋㅋ)/.test(text)) return 'visual_card_caption';
  if (/오늘|날씨|더워|추워|비 와|습해|봄|여름|가을|겨울/.test(text)) return 'seasonal_life';
  if (/요즘|유행|많이 보이|다들 하|릴스|스레드|인스타/.test(text)) return 'trend_reaction';
  if (lines <= 3 && /(처음엔|그러다|결국|하고\s*끝|다시\s*누움|방치)/.test(text)) return 'micro_story';
  if (lines <= 4) return 'plain_observation';
  return 'mini_story';
}

export function inferContentGoal(body = '', contentType = '', format = '') {
  const text = normalizeText(body);
  const resolvedFormat = normalizeContentFormat(format) || inferContentFormat(body, contentType);
  if (['send_to_friend'].includes(resolvedFormat)) return 'share';
  if (['meme_caption', 'visual_card_caption', 'room_reality', 'fake_chat', 'before_after', 'pov_scene', 'myth_reality', 'photo_dump_caption'].includes(resolvedFormat)) return 'meme';
  if (['ranked_list'].includes(resolvedFormat)) return 'save';
  if (['imaginary_reply'].includes(resolvedFormat)) return 'community';
  if (['series_note'].includes(resolvedFormat)) return 'curiosity';
  if (['random_life_complaint', 'lazy_person_tip'].includes(resolvedFormat)) return /[?？]|나만|다들|공감|겪어본/.test(text) ? 'reply' : 'rant';
  if (['tiny_confession'].includes(resolvedFormat)) return /[?？]|나만|다들|공감|겪어본|아니지|맞지/.test(text) ? 'reply' : 'confession';
  if (['daily_one_liner', 'two_line_empathy', 'plain_observation', 'micro_story'].includes(resolvedFormat)) {
    return /[?？]|나만|다들|공감|겪어본|아니지|맞지/.test(text) ? 'reply' : 'reach_only';
  }
  if (['checklist_card', 'before_buy_check'].includes(resolvedFormat)) return 'save';
  if (['anti_buy', 'wrong_purchase'].includes(resolvedFormat)) return 'anti_buy';
  if (['collection_bridge', 'direct_product'].includes(resolvedFormat)) return 'conversion';
  if (resolvedFormat === 'choice_question' || resolvedFormat === 'soft_question' || resolvedFormat === 'mini_poll') return 'reply';
  if (resolvedFormat === 'seasonal_life') return 'seasonal_spike';
  if (resolvedFormat === 'mini_story') return 'trust';
  return 'experiment';
}

export function resolveContentStrategyMetadata(item = {}, body = '', contentType = '') {
  const contentFormat = normalizeContentFormat(item.contentFormat || item.content_format)
    || inferContentFormat(body, contentType);
  const contentGoal = normalizeContentGoal(item.contentGoal || item.content_goal)
    || inferContentGoal(body, contentType, contentFormat);
  return { contentFormat, contentGoal };
}

export function contentLengthBucket(body = '') {
  const text = normalizeText(body);
  const lines = lineCount(body);
  if (lines <= 1 && text.length <= 60) return 'one_line';
  if (lines <= 2 && text.length <= 110) return 'two_line';
  if (lines <= 4 && text.length <= 180) return 'short';
  return 'medium';
}

export function scoreFormatDiversity({ contentFormat, contentGoal, body }, recentPosts = []) {
  const recent = recentPosts.slice(0, 10);
  const formatCount = recent.filter((post) => post?.metadata?.contentFormat === contentFormat).length;
  const goalCount = recent.filter((post) => post?.metadata?.contentGoal === contentGoal).length;
  const bucket = contentLengthBucket(body);
  const lengthCount = recent.filter((post) => post?.metadata?.lengthBucket === bucket).length;
  const consecutiveFormat = recent.slice(0, 3).filter((post) => post?.metadata?.contentFormat === contentFormat).length;
  const penalty = Math.min(35,
    Math.max(0, formatCount - 2) * 8
    + Math.max(0, goalCount - 4) * 5
    + Math.max(0, lengthCount - 4) * 4
    + (consecutiveFormat >= 2 ? 12 : 0)
  );
  return {
    contentFormat,
    contentGoal,
    lengthBucket: bucket,
    recentFormatCount: formatCount,
    recentGoalCount: goalCount,
    recentLengthBucketCount: lengthCount,
    consecutiveFormat,
    penalty,
    duplicateRisk: penalty >= 20,
    adjustedScore(score) {
      return clampScore((Number(score) || 0) - penalty);
    }
  };
}

const CONTENT_MIX_SLOTS = [
  {
    key: 'short_reach',
    label: '짧은 조회수/공감 글',
    goals: ['reach_only', 'confession', 'rant'],
    formats: ['daily_one_liner', 'two_line_empathy', 'tiny_confession', 'random_life_complaint', 'micro_story'],
    lengthBuckets: ['one_line', 'two_line']
  },
  {
    key: 'share_meme',
    label: '친구 공유/밈 카드형',
    goals: ['share', 'meme'],
    formats: ['send_to_friend', 'room_reality', 'visual_card_caption', 'meme_caption', 'fake_chat', 'before_after'],
    lengthBuckets: ['one_line', 'two_line', 'short']
  },
  {
    key: 'reply_poll',
    label: '댓글 갈림/미니 투표형',
    goals: ['reply'],
    formats: ['mini_poll', 'choice_question', 'soft_question', 'two_line_empathy'],
    lengthBuckets: ['two_line', 'short']
  },
  {
    key: 'save_anti_buy',
    label: '저장형 기준/사지 말 것',
    goals: ['save', 'anti_buy'],
    formats: ['before_buy_check', 'anti_buy', 'wrong_purchase', 'anti_aesthetic', 'checklist_card'],
    lengthBuckets: ['short', 'medium']
  },
  {
    key: 'trust_story',
    label: '조금 긴 일상/경험담',
    goals: ['trust', 'reach_only'],
    formats: ['mini_story', 'plain_observation', 'micro_story'],
    lengthBuckets: ['short', 'medium']
  },
  {
    key: 'conversion_bridge',
    label: '상품 전환 전 생활 기준',
    goals: ['conversion'],
    formats: ['collection_bridge', 'direct_product'],
    lengthBuckets: ['short', 'medium']
  },
  {
    key: 'seasonal_spike',
    label: '시즌/트렌드 반응',
    goals: ['seasonal_spike', 'experiment'],
    formats: ['seasonal_life', 'trend_reaction', 'plain_observation'],
    lengthBuckets: ['one_line', 'two_line', 'short']
  },
  {
    key: 'native_scene',
    label: 'POV/생각vs현실/사진첩 캡션',
    goals: ['meme', 'curiosity'],
    formats: ['pov_scene', 'myth_reality', 'photo_dump_caption', 'series_note'],
    lengthBuckets: ['one_line', 'two_line', 'short']
  },
  {
    key: 'community_answer',
    label: '댓글 답변/우선순위형',
    goals: ['community', 'save', 'reply'],
    formats: ['imaginary_reply', 'ranked_list', 'mini_poll'],
    lengthBuckets: ['short', 'medium']
  }
];

function recentSlotCount(slot, recentPosts = []) {
  return recentPosts.slice(0, 12).filter((post) => {
    const metadata = post?.metadata || {};
    return slot.goals.includes(metadata.contentGoal) || slot.formats.includes(metadata.contentFormat);
  }).length;
}

function performanceSlotScore(slot, performanceSignals = null) {
  if (!performanceSignals) return 0;
  const formatClicks = (performanceSignals.topContentFormats || [])
    .filter((item) => slot.formats.includes(item.name))
    .reduce((sum, item) => sum + Number(item.clicks || 0), 0);
  const goalClicks = (performanceSignals.topContentGoals || [])
    .filter((item) => slot.goals.includes(item.name))
    .reduce((sum, item) => sum + Number(item.clicks || 0), 0);
  return Math.min(30, (formatClicks * 2) + goalClicks);
}

function rotateList(list = [], seed = '') {
  if (!list.length) return [];
  const offset = stableBucket(seed, list.length);
  return list.slice(offset).concat(list.slice(0, offset));
}

function revealModeForBlueprint(slotKey = '', seed = '') {
  const normalFirstSlots = new Set(['short_reach', 'share_meme', 'native_scene', 'community_answer', 'trust_story']);
  const modes = normalFirstSlots.has(slotKey)
    ? ['situation_first', 'item_late', 'no_item_name']
    : ['situation_first', 'criteria_first', 'item_late'];
  return modes[stableBucket(`${seed}:reveal`, modes.length)];
}

function questionModeForBlueprint(slotKey = '', index = 0) {
  if (slotKey === 'reply_poll' || slotKey === 'community_answer') return 'may_end_with_question';
  if (index >= 3) return 'no_question';
  return 'optional_soft_question';
}

function buildCandidateBlueprints(slots = [], seed = '') {
  const fallbackSlots = CONTENT_MIX_SLOTS.slice(0, 5);
  const sourceSlots = slots.length ? slots : fallbackSlots;
  const uniqueByKey = [];
  const seen = new Set();
  for (const slot of sourceSlots.concat(CONTENT_MIX_SLOTS)) {
    if (!slot?.key || seen.has(slot.key)) continue;
    seen.add(slot.key);
    uniqueByKey.push(slot);
    if (uniqueByKey.length >= 5) break;
  }
  return uniqueByKey.slice(0, 5).map((slot, index) => {
    const blueprintSeed = `${seed}:${slot.key}:${index}`;
    return {
      candidateIndex: index + 1,
      slotKey: slot.key,
      slotLabel: slot.label,
      preferredGoal: rotateList(slot.goals, blueprintSeed)[0],
      preferredFormats: rotateList(slot.formats, blueprintSeed).slice(0, 3),
      targetLengthBucket: rotateList(slot.lengthBuckets, blueprintSeed)[0],
      revealMode: revealModeForBlueprint(slot.key, blueprintSeed),
      questionMode: questionModeForBlueprint(slot.key, index),
      directive: [
        `slot=${slot.label}`,
        `length=${rotateList(slot.lengthBuckets, blueprintSeed)[0]}`,
        `reveal=${revealModeForBlueprint(slot.key, blueprintSeed)}`,
        `question=${questionModeForBlueprint(slot.key, index)}`
      ].join('; ')
    };
  });
}

export function buildContentDiversityPlan({ topic = {}, account = {}, recentPosts = [], performanceSignals = null } = {}) {
  const seed = `${account.id || ''}:${topic.id || ''}:${topic.title || ''}:${recentPosts.length}`;
  const rankedSlots = CONTENT_MIX_SLOTS
    .map((slot, index) => ({
      ...slot,
      recentCount: recentSlotCount(slot, recentPosts),
      performanceScore: performanceSlotScore(slot, performanceSignals || account.performanceSignals),
      randomTieBreaker: stableBucket(`${seed}:${slot.key}`, 100),
      index
    }))
    .sort((a, b) => {
      if (a.recentCount !== b.recentCount) return a.recentCount - b.recentCount;
      if (a.recentCount <= 1 && b.recentCount <= 1 && a.performanceScore !== b.performanceScore) {
        return b.performanceScore - a.performanceScore;
      }
      return a.randomTieBreaker - b.randomTieBreaker;
    });
  const primary = rankedSlots[0];
  const secondary = rankedSlots.slice(1, 4);
  return {
    primarySlot: {
      key: primary.key,
      label: primary.label,
      goals: primary.goals,
      formats: primary.formats,
      lengthBuckets: primary.lengthBuckets,
      recentCount: primary.recentCount,
      performanceScore: primary.performanceScore
    },
    secondarySlots: secondary.map((slot) => ({
      key: slot.key,
      label: slot.label,
      goals: slot.goals,
      formats: slot.formats,
      lengthBuckets: slot.lengthBuckets,
      recentCount: slot.recentCount,
      performanceScore: slot.performanceScore
    })),
    candidateBlueprints: buildCandidateBlueprints([primary, ...secondary], seed),
    instruction: '이번 생성에서는 candidateBlueprints를 후보 1-5의 역할표로 사용한다. primarySlot 후보를 최소 1개, secondarySlots 중 서로 다른 후보를 최소 2개 섞고, 최종 선택도 최근 덜 나온 슬롯을 우대한다.'
  };
}

export function scoreContentDiversityPlanFit({ contentFormat, contentGoal, body } = {}, plan = null) {
  if (!plan?.primarySlot) return { bonus: 0, matchedSlot: null, matchedReason: null };
  const bucket = contentLengthBucket(body);
  const slots = [plan.primarySlot, ...(plan.secondarySlots || [])];
  for (const [index, slot] of slots.entries()) {
    const formatMatch = slot.formats?.includes(contentFormat);
    const goalMatch = slot.goals?.includes(contentGoal);
    const lengthMatch = slot.lengthBuckets?.includes(bucket);
    if (!formatMatch && !goalMatch) continue;
    const base = index === 0 ? 16 : 8;
    const bonus = base + (formatMatch ? 5 : 0) + (goalMatch ? 4 : 0) + (lengthMatch ? 3 : 0);
    return {
      bonus,
      matchedSlot: slot.key,
      matchedReason: `${slot.label} 슬롯 매칭`,
      lengthBucket: bucket
    };
  }
  return { bonus: 0, matchedSlot: null, matchedReason: null, lengthBucket: bucket };
}

export function isShortReachFormat(format = '', goal = '') {
  return ['reach_only', 'share', 'meme', 'rant', 'confession'].includes(goal)
    || ['daily_one_liner', 'two_line_empathy', 'random_life_complaint', 'fake_chat', 'before_after', 'meme_caption', 'plain_observation', 'send_to_friend', 'tiny_confession', 'wrong_purchase', 'room_reality', 'lazy_person_tip', 'visual_card_caption', 'micro_story', 'pov_scene', 'myth_reality', 'photo_dump_caption', 'series_note'].includes(format);
}
