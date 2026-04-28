create table if not exists purchase_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  plan text not null default 'onetime',
  source text not null default 'cujasa',
  created_at timestamptz not null default now()
);

create index if not exists idx_inquiries_created on purchase_inquiries(created_at desc);
