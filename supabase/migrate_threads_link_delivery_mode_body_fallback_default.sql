alter table accounts
  alter column threads_link_delivery_mode set default 'body_fallback';

update accounts
set threads_link_delivery_mode = 'body_fallback'
where threads_link_delivery_mode is null
   or threads_link_delivery_mode = 'reply';
