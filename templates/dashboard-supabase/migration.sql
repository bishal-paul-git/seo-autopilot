-- Stores URL Inspection results for the admin SEO page (written by the 'seo' edge function).
create table if not exists public.seo_inspections (
  url text primary key,
  checked_at timestamptz not null default now(),
  coverage text,
  fetch_state text,
  last_crawl timestamptz,
  google_canonical text
);

alter table public.seo_inspections enable row level security;

-- Admins can read; writes happen only with the service role inside the edge function.
create policy "admins read seo_inspections" on public.seo_inspections
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
-- Daily Search Console totals written by the seo-ingest edge function; read by /admin/seo.
create table if not exists public.seo_daily_summary (
  day date primary key,
  clicks int not null default 0,
  impressions int not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  inspected int not null default 0,
  not_indexed int not null default 0
);

alter table public.seo_daily_summary enable row level security;

create policy "admins read seo_daily_summary" on public.seo_daily_summary
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
-- Autopilot results written by the seo-ingest edge function; read by /admin/seo.
create table if not exists public.seo_backlinks (
  target_id text primary key,
  name text not null,
  submit_url text,
  mode text,
  status text not null,
  attempts int not null default 0,
  last_attempt date,
  next_attempt date,
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.seo_digests (
  week date primary key,
  markdown text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.seo_topics (
  query text primary key,
  kind text,
  impressions int not null default 0,
  position numeric,
  status text not null default 'new',
  unverified boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.seo_backlinks enable row level security;
alter table public.seo_digests enable row level security;
alter table public.seo_topics enable row level security;

create policy "admins read seo_backlinks" on public.seo_backlinks
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins read seo_digests" on public.seo_digests
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins read seo_topics" on public.seo_topics
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
