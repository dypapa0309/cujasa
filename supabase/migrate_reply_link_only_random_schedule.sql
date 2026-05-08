alter table accounts
  alter column threads_link_delivery_mode set default 'reply';

update accounts
set threads_link_delivery_mode = 'reply'
where threads_link_delivery_mode is null
   or threads_link_delivery_mode <> 'reply';

alter table accounts
  drop constraint if exists accounts_threads_link_delivery_mode_check;

alter table accounts
  add constraint accounts_threads_link_delivery_mode_check
  check (threads_link_delivery_mode = 'reply');
