export const REPETITIVE_CONTENT_RULES = [
  {
    id: 'pretty-first-annoying-later',
    label: '예쁜 것부터 보이다가 귀찮은 순간이 기준을 바꾸는 구조',
    pattern: /고를\s*때\s*처음엔\s*예쁜\s*것부터\s*보이는데[\s\S]*귀찮은\s*순간이\s*기준을\s*바꾸더라고요/i,
    promptExample: '고를 때 처음엔 예쁜 것부터 보이는데 ... 귀찮은 순간이 기준을 바꾸더라고요'
  },
  {
    id: 'put-back-less-effort-floor',
    label: '다시 넣을 때 손이 덜 가서 바닥에 덜 쌓이는 구조',
    pattern: /다시\s*넣을\s*때\s*손이\s*덜\s*가는\s*구조처럼[\s\S]*바닥에\s*쌓이는\s*일이\s*확\s*줄어요/i,
    promptExample: '다시 넣을 때 손이 덜 가는 구조처럼 ... 바닥에 쌓이는 일이 확 줄어요'
  },
  {
    id: 'daily-use-over-pretty',
    label: '예쁜 쪽보다 매일 쓰는 순간이 더 티 나는 구조',
    pattern: /예쁜\s*쪽보다\s*매일\s*쓰는\s*순간이\s*더\s*빨리\s*티\s*나/i,
    promptExample: '예쁜 쪽보다 매일 쓰는 순간이 더 빨리 티 나'
  },
  {
    id: 'performance-over-placement',
    label: '성능보다 놓는 자리에서 갈리는 구조',
    pattern: /성능보다\s*놓는\s*자리|사고\s*나서\s*제일\s*아쉬운\s*건\s*보통\s*성능보다\s*놓는\s*자리/i,
    promptExample: '성능보다 놓는 자리'
  },
  {
    id: 'clean-look-vs-easy-access',
    label: '보이는 깔끔함과 꺼내기 편한 쪽 비교 구조',
    pattern: /고를\s*때\s*(저는|나는)?\s*보이는\s*깔끔함이랑\s*꺼내기\s*편한\s*쪽|보이는\s*깔끔함이랑\s*꺼내기\s*편한\s*쪽/i,
    promptExample: '보이는 깔끔함이랑 꺼내기 편한 쪽'
  },
  {
    id: 'long-use-placement',
    label: '오래 쓰는 기준은 기능보다 자리라는 구조',
    pattern: /오래\s*쓰는\s*기준은\s*기능보다\s*자리/i,
    promptExample: '오래 쓰는 기준은 기능보다 자리'
  },
  {
    id: 'function-first-place-first',
    label: '기능을 먼저 보지만 매일 쓰면 자리가 먼저 보이는 구조',
    pattern: /처음엔\s*기능을\s*먼저\s*보게\s*되는데,\s*막상\s*매일\s*쓰면\s*자리가\s*먼저\s*보이|막상\s*살아보면\s*큰\s*기능보다/i,
    promptExample: '막상 살아보면 큰 기능보다'
  },
  {
    id: 'where-to-put-first',
    label: '많이 사는 것보다 어디에 둘지부터 보는 구조',
    pattern: /많이\s*사는\s*것보다\s*["“]?어디에\s*둘지["”]?\s*부터|자취템은\s*막상\s*써보면\s*예쁜\s*것보다\s*어디에\s*둘지/i,
    promptExample: '많이 사는 것보다 "어디에 둘지"부터'
  },
  {
    id: 'take-out-put-back-moment',
    label: '꺼내고 다시 두는 순간으로 판단하는 구조',
    pattern: /꺼내고\s*다시\s*두는\s*순간/i,
    promptExample: '꺼내고 다시 두는 순간'
  },
  {
    id: 'not-only-me-tail',
    label: '나만 불편한 줄 알았는데 많이 겪는 상황 후렴',
    pattern: /이거\s*은근\s*나만\s*불편한\s*줄\s*알았는데\s*생각보다\s*많이\s*겪는\s*상황/i,
    promptExample: '이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요'
  },
  {
    id: 'criteria-split-point-tail',
    label: '상황마다 기준이 갈리는 포인트 후렴',
    pattern: /이건\s*상황마다\s*기준이\s*은근\s*갈리는\s*포인트/i,
    promptExample: '이건 상황마다 기준이 은근 갈리는 포인트야'
  },
  {
    id: 'first-week-answer-tail',
    label: '첫 주에 불편하면 계속 불편하고 여기서 답 나오는 구조',
    pattern: /첫\s*주에\s*불편하면\s*거의\s*계속\s*불편하더라고요[\s\S]*여기서\s*이미\s*답\s*나오는\s*경우\s*많/i,
    promptExample: '{카테고리}은 첫 주에 불편하면 거의 계속 불편하더라고요 ... 여기서 이미 답 나오는 경우 많아요'
  }
];

export function findRepetitiveContentMatches(body = '') {
  const text = String(body || '');
  if (!text.trim()) return [];
  return REPETITIVE_CONTENT_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({
      id: rule.id,
      label: rule.label
    }));
}

export function hasRepetitiveContentPattern(body = '') {
  return findRepetitiveContentMatches(body).length > 0;
}

export function buildRepetitiveContentPromptRule() {
  const examples = REPETITIVE_CONTENT_RULES
    .map((rule) => rule.promptExample)
    .filter(Boolean)
    .slice(0, 12)
    .map((example) => `"${example}"`)
    .join(', ');
  return `Hard-ban recently overused CUJASA tails and skeletons. Never write these exact phrases or close paraphrases: ${examples}.`;
}
