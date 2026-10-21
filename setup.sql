-- Cronología: tabla de notas y carpeta de fotos, con acceso solo para el dueño de cada dato.
-- Pegar completo en Supabase > SQL Editor > Run.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '' check (char_length(body) <= 6000),
  year int not null check (year between 1000 and 2200),
  month int not null default 0 check (month between 0 and 12),
  day int not null default 0 check (day between 0 and 31),
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notes_user_date_idx on public.notes (user_id, year, month, day);

alter table public.notes enable row level security;
revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;

drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;

create policy "notes_select_own" on public.notes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notes_insert_own" on public.notes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "notes_update_own" on public.notes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notes_delete_own" on public.notes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Fotos: carpeta privada, cada usuario solo toca su propia subcarpeta (nombre = id del usuario).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "fotos_select_own" on storage.objects;
drop policy if exists "fotos_insert_own" on storage.objects;
drop policy if exists "fotos_update_own" on storage.objects;
drop policy if exists "fotos_delete_own" on storage.objects;

create policy "fotos_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
