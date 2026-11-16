-- Push com o site fechado (Web Push). Rode UMA vez no SQL Editor do Supabase.
-- Veja PUSH-SETUP.md para o passo a passo completo.

-- Um aparelho inscrito por linha.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- Resumo diário que o app envia (o que vence em cada dia dos próximos 30), horários de aviso e fuso.
-- É isso que a função lê: ela não abre o seu estado de estudo.
create table if not exists public.reminder_digests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  digest jsonb not null default '{}'::jsonb,
  tz text not null default 'America/Sao_Paulo',
  last_sent jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.reminder_digests enable row level security;

drop policy if exists "reminder_digests_select_own" on public.reminder_digests;
create policy "reminder_digests_select_own" on public.reminder_digests
  for select using (auth.uid() = user_id);

drop policy if exists "reminder_digests_insert_own" on public.reminder_digests;
create policy "reminder_digests_insert_own" on public.reminder_digests
  for insert with check (auth.uid() = user_id);

drop policy if exists "reminder_digests_update_own" on public.reminder_digests;
create policy "reminder_digests_update_own" on public.reminder_digests
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reminder_digests_delete_own" on public.reminder_digests;
create policy "reminder_digests_delete_own" on public.reminder_digests
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- AGENDAMENTO (rode separado, depois de implantar a função e criar os segredos).
-- Ative antes as extensões pg_cron e pg_net em Database > Extensions.
-- Troque <PROJECT_REF> e <CRON_SECRET> (o mesmo valor do segredo da função).
--
-- select cron.schedule(
--   'estudos-track-send-reminders',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- Para remover: select cron.unschedule('estudos-track-send-reminders');
-- ---------------------------------------------------------------------------
