-- NovaDesk · migración 4 (ejecutar DESPUÉS de migracion-03-permisos.sql): archivos adjuntos en los tickets.
--
-- Los archivos (capturas, PDF, correos…) viven en un bucket PRIVADO de Supabase Storage; su ficha (nombre, tipo, tamaño,
-- quién lo subió) en la tabla ticket_attachments. Se descargan con URL firmadas de corta duración, nunca públicas.
--
--   · Quien puede ver un ticket puede ver y adjuntar archivos (el técnico, solo en sus tickets; un usuario inactivo, en ninguno).
--   · Solo quien subió un archivo, un analista o el administrador pueden borrarlo. Nadie puede editarlo.
--   · 10 MB por archivo y solo documentos (imágenes, PDF, Office, texto, CSV, ZIP y correos .eml/.msg): nada ejecutable.
--   · Primero se registra la ficha y después se sube el archivo: Storage solo acepta archivos que tengan su ficha y estén
--     en la carpeta de un ticket que quien sube puede ver (ruta «ID-del-ticket/archivo»).
--
-- Es seguro ejecutarla más de una vez. Para deshacerla, ver «Deshacer» al final. Para probarla, docs/pruebas-permisos.sql.

-- ───────────── 1) Bucket privado ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (
  'ticket-files', 'ticket-files', false, 10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/zip', 'application/x-zip-compressed', 'message/rfc822', 'application/vnd.ms-outlook'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ───────────── 2) Ficha de cada archivo ─────────────
create table if not exists public.ticket_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     text not null references public.tickets(id) on delete cascade,
  uploader_id   uuid references public.profiles(id) on delete set null,
  file_name     text not null check (char_length(file_name) between 1 and 200),
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path  text not null unique,                 -- «I-0001/<uuid>-captura.png» dentro del bucket ticket-files
  created_at    timestamptz not null default now()
);
create index if not exists ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id, created_at);

alter table public.ticket_attachments enable row level security;
revoke all on public.ticket_attachments from anon;

drop policy if exists attachments_read on public.ticket_attachments;
create policy attachments_read on public.ticket_attachments for select to authenticated
  using (can_see_ticket(ticket_id));
drop policy if exists attachments_insert on public.ticket_attachments;
create policy attachments_insert on public.ticket_attachments for insert to authenticated
  with check (uploader_id = auth.uid() and can_see_ticket(ticket_id) and storage_path like ticket_id || '/%');
drop policy if exists attachments_delete on public.ticket_attachments;
create policy attachments_delete on public.ticket_attachments for delete to authenticated
  using (can_see_ticket(ticket_id) and (uploader_id = auth.uid() or app_role() in ('admin', 'analista')));

-- La fecha la pone el servidor (igual que en comentarios e historial).
drop trigger if exists stamp_created_at on public.ticket_attachments;
create trigger stamp_created_at before insert on public.ticket_attachments
for each row execute function public.stamp_created_at();

-- ───────────── 3) Permisos sobre los archivos (Storage) ─────────────
drop policy if exists ticket_files_read on storage.objects;
create policy ticket_files_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-files' and public.can_see_ticket((storage.foldername(name))[1]));

drop policy if exists ticket_files_insert on storage.objects;
create policy ticket_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-files' and public.can_see_ticket((storage.foldername(name))[1])
              and exists (select 1 from public.ticket_attachments a where a.storage_path = name and a.uploader_id = auth.uid()));

-- Se borra primero el archivo y después su ficha, por eso aquí todavía debe existir la ficha.
drop policy if exists ticket_files_delete on storage.objects;
create policy ticket_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-files'
         and exists (select 1 from public.ticket_attachments a
                     where a.storage_path = name and (a.uploader_id = auth.uid() or public.app_role() in ('admin', 'analista'))));

-- ───────────── Deshacer ─────────────
-- (Los archivos ya subidos hay que borrarlos desde Storage > ticket-files antes de quitar el bucket.)
-- drop policy if exists ticket_files_read   on storage.objects;
-- drop policy if exists ticket_files_insert on storage.objects;
-- drop policy if exists ticket_files_delete on storage.objects;
-- drop table if exists public.ticket_attachments;
-- delete from storage.buckets where id = 'ticket-files';
