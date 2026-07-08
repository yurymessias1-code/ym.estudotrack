create table if not exists public.study_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.study_profiles
  add column if not exists email text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.study_profiles enable row level security;

create index if not exists study_profiles_email_idx
on public.study_profiles (lower(email));

create or replace function public.set_study_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_study_profiles_updated_at on public.study_profiles;
create trigger set_study_profiles_updated_at
before update on public.study_profiles
for each row
execute function public.set_study_profiles_updated_at();

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
