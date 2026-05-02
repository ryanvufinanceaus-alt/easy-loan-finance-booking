create table if not exists public.brokers (
  id text primary key,
  name text not null,
  title text not null default 'Finance Broker',
  location text not null default 'Adelaide, SA',
  email text,
  phone text,
  "accessCode" text,
  color text not null default '#b89044',
  services jsonb not null default '[]'::jsonb,
  hours jsonb not null default '{"start":"09:00","end":"17:00"}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id text primary key,
  "clientName" text not null,
  phone text,
  email text,
  "brokerId" text not null references public.brokers(id) on delete cascade,
  service text not null,
  channel text not null default 'Phone call',
  status text not null default 'Confirmed',
  start timestamptz not null,
  "end" timestamptz not null,
  "googleEventId" text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists bookings_broker_start_idx on public.bookings ("brokerId", start);
create index if not exists bookings_start_idx on public.bookings (start);

alter table public.brokers add column if not exists "accessCode" text;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.brokers enable row level security;
alter table public.bookings enable row level security;
alter table public.app_settings enable row level security;

insert into public.brokers (id, name, title, location, email, phone, color, services, hours)
values
  (
    'ryan-vu',
    'Ryan Vu',
    'Finance Broker',
    'Adelaide, SA',
    'ryan@easyloanfinance.com.au',
    '0400 000 000',
    '#b89044',
    '["First home buyer","Refinance","Investment loan","Commercial lending"]'::jsonb,
    '{"start":"09:00","end":"18:00"}'::jsonb
  ),
  (
    'team-broker-1',
    'Mia Nguyen',
    'Senior Broker',
    'Adelaide, SA',
    'mia@easyloanfinance.com.au',
    '0400 000 001',
    '#2f7d74',
    '["Pre-approval","Construction loan","Debt consolidation"]'::jsonb,
    '{"start":"09:00","end":"17:30"}'::jsonb
  ),
  (
    'team-broker-2',
    'Daniel Park',
    'Credit Specialist',
    'Melbourne, VIC',
    'daniel@easyloanfinance.com.au',
    '0400 000 002',
    '#8b5d6b',
    '["Complex income","Asset finance","Business lending"]'::jsonb,
    '{"start":"08:30","end":"17:00"}'::jsonb
  )
on conflict (id) do nothing;
