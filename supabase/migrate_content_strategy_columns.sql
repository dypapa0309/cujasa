alter table accounts
  add column if not exists content_mode text not null default 'auto',
  add column if not exists content_intensity text not null default 'normal',
  add column if not exists seasonality_enabled boolean not null default true,
  add column if not exists comment_induction_style text not null default 'soft_question',
  add column if not exists product_mention_style text not null default 'natural',
  add column if not exists emoji_level text not null default 'low',
  add column if not exists safe_debate_enabled boolean not null default false,
  add column if not exists content_style_note text;

update accounts
set content_mode = case
  when coalesce(tone, '') ~ '일상' then 'daily'
  when coalesce(tone, '') ~ '체크|기준' then 'checklist'
  when coalesce(tone, '') ~ '질문|댓글' or coalesce(cta_style, '') ~ '질문|댓글' then 'question'
  when coalesce(tone, '') ~ '문제|해결' then 'problem_solution'
  when coalesce(tone, '') ~ '공감|친근' then 'empathy'
  else coalesce(nullif(content_mode, ''), 'empathy')
end
where content_mode is null or content_mode = 'empathy';

update accounts
set comment_induction_style = 'soft_question'
where coalesce(cta_style, '') ~ '댓글|질문';

update accounts
set content_style_note = trim(both E'\n' from concat_ws(E'\n',
  nullif(concat('기존 톤: ', nullif(tone, '')), '기존 톤: '),
  nullif(concat('기존 CTA: ', nullif(cta_style, '')), '기존 CTA: ')
))
where content_style_note is null
  and (nullif(tone, '') is not null or nullif(cta_style, '') is not null);

alter table accounts
  drop constraint if exists accounts_content_mode_check,
  drop constraint if exists accounts_content_intensity_check,
  drop constraint if exists accounts_comment_induction_style_check,
  drop constraint if exists accounts_product_mention_style_check,
  drop constraint if exists accounts_emoji_level_check;

alter table accounts
  add constraint accounts_content_mode_check
    check (content_mode in ('auto', 'daily', 'empathy', 'problem_solution', 'checklist', 'question', 'safe_debate')),
  add constraint accounts_content_intensity_check
    check (content_intensity in ('soft', 'normal', 'strong')),
  add constraint accounts_comment_induction_style_check
    check (comment_induction_style in ('none', 'soft_question', 'experience_question', 'choice_question')),
  add constraint accounts_product_mention_style_check
    check (product_mention_style in ('none', 'natural', 'direct')),
  add constraint accounts_emoji_level_check
    check (emoji_level in ('none', 'low', 'medium'));

create index if not exists idx_accounts_content_mode
  on accounts(content_mode);
