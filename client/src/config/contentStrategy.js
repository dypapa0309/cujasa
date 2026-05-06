export const contentModeOptions = [
  { value: 'daily', label: '일상형', description: '생활 속 장면에서 자연스럽게 시작' },
  { value: 'empathy', label: '공감형', description: '불편함이나 마음을 먼저 짚는 방식' },
  { value: 'problem_solution', label: '문제 해결형', description: '문제와 선택 기준을 분명히 제시' },
  { value: 'checklist', label: '체크리스트형', description: '짧은 기준과 포인트 중심' },
  { value: 'question', label: '질문형', description: '댓글로 답하기 쉬운 질문 중심' },
  { value: 'safe_debate', label: '안전 논쟁형', description: '취향/상황 차이 질문만 사용' }
];

export const contentIntensityOptions = [
  { value: 'soft', label: '부드럽게' },
  { value: 'normal', label: '보통' },
  { value: 'strong', label: '강하게' }
];

export const commentStyleOptions = [
  { value: 'none', label: '댓글 유도 안 함' },
  { value: 'soft_question', label: '부드러운 질문' },
  { value: 'experience_question', label: '경험 질문' },
  { value: 'choice_question', label: '선택 질문' }
];

export const productMentionOptions = [
  { value: 'none', label: '상품명 언급 최소화' },
  { value: 'natural', label: '자연스럽게 언급' },
  { value: 'direct', label: '직접 언급' }
];

export const emojiLevelOptions = [
  { value: 'none', label: '사용 안 함' },
  { value: 'low', label: '적게' },
  { value: 'medium', label: '보통' }
];
