create table if not exists public.study_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.study_profiles enable row level security;

drop policy if exists "study_profiles_select_own" on public.study_profiles;
create policy "study_profiles_select_own"
on public.study_profiles
for select
using (auth.uid() = user_id);

drop policy if exists "study_profiles_insert_own" on public.study_profiles;
create policy "study_profiles_insert_own"
on public.study_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "study_profiles_update_own" on public.study_profiles;
create policy "study_profiles_update_own"
on public.study_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "study_profiles_delete_own" on public.study_profiles;
create policy "study_profiles_delete_own"
on public.study_profiles
for delete
using (auth.uid() = user_id);
