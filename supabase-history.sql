-- Histórico de versões da conta (Estudos Track).
-- Rode uma vez no SQL Editor do Supabase (depois do supabase-schema.sql). Pode rodar de novo sem problema.
--
-- Como funciona: sempre que o estado da conta é atualizado, o servidor guarda a versão ANTERIOR numa tabela
-- de histórico, no máximo uma a cada 2 horas. Ficam todas as versões das últimas 24 horas e uma por dia
-- (a primeira do dia) até 14 dias. As cópias "antes de restaurar" (feitas pelo app) ficam as 5 mais recentes.
-- Na aba Conta do site, "Versões na nuvem" lista essas cópias e permite voltar a uma delas.

create table if not exists public.study_profiles_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  kind text not null default 'auto' check (kind in ('auto', 'antes-de-restaurar')),
  saved_at timestamptz not null default now()
);

create index if not exists study_profiles_history_user_idx
on public.study_profiles_history (user_id, saved_at desc);

alter table public.study_profiles_history enable row level security;

grant select, insert, delete on public.study_profiles_history to authenticated;

-- Cada pessoa vê, cria (só cópias "antes de restaurar") e apaga apenas o que é seu. Ninguém edita versões.
drop policy if exists "study_profiles_history_select_own" on public.study_profiles_history;
create policy "study_profiles_history_select_own"
on public.study_profiles_history
for select
using (auth.uid() = user_id);

drop policy if exists "study_profiles_history_insert_own" on public.study_profiles_history;
create policy "study_profiles_history_insert_own"
on public.study_profiles_history
for insert
with check (auth.uid() = user_id and kind = 'antes-de-restaurar');

drop policy if exists "study_profiles_history_delete_own" on public.study_profiles_history;
create policy "study_profiles_history_delete_own"
on public.study_profiles_history
for delete
using (auth.uid() = user_id);

create or replace function public.snapshot_study_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nada a guardar se o estado antigo era vazio ou se a gravação não mudou o conteúdo.
  if old.state is null or old.state = '{}'::jsonb or old.state is not distinct from new.state then
    return new;
  end if;

  if not exists (
    select 1 from public.study_profiles_history h
    where h.user_id = old.user_id and h.kind = 'auto' and h.saved_at > now() - interval '2 hours'
  ) then
    insert into public.study_profiles_history (user_id, state, kind)
    values (old.user_id, old.state, 'auto');

    -- Passadas 24 horas, fica só a primeira versão de cada dia; depois de 14 dias, nenhuma.
    delete from public.study_profiles_history h
    where h.user_id = old.user_id
      and h.kind = 'auto'
      and h.saved_at < now() - interval '24 hours'
      and (
        h.saved_at < now() - interval '14 days'
        or exists (
          select 1 from public.study_profiles_history k
          where k.user_id = h.user_id and k.kind = 'auto'
            and date_trunc('day', k.saved_at) = date_trunc('day', h.saved_at)
            and k.saved_at < h.saved_at
        )
      );
  end if;

  delete from public.study_profiles_history h
  where h.user_id = old.user_id
    and h.kind <> 'auto'
    and h.id not in (
      select s.id from public.study_profiles_history s
      where s.user_id = old.user_id and s.kind <> 'auto'
      order by s.saved_at desc
      limit 5
    );

  return new;
end;
$$;

drop trigger if exists study_profiles_snapshot on public.study_profiles;
create trigger study_profiles_snapshot
before update on public.study_profiles
for each row
execute function public.snapshot_study_profile();
