-- Prints do caderno de erros (Estudos Track): bucket privado, uma pasta por usuário.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('erro-prints', 'erro-prints', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada usuário só enxerga e mexe na pasta cujo nome é o seu user_id: <user_id>/<id do print>.
drop policy if exists "erro_prints_select_own" on storage.objects;
create policy "erro_prints_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'erro-prints' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "erro_prints_insert_own" on storage.objects;
create policy "erro_prints_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'erro-prints' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "erro_prints_update_own" on storage.objects;
create policy "erro_prints_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'erro-prints' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'erro-prints' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "erro_prints_delete_own" on storage.objects;
create policy "erro_prints_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'erro-prints' and (storage.foldername(name))[1] = auth.uid()::text);
