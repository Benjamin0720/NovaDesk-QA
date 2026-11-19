-- NovaDesk · migración 5 (ejecutar DESPUÉS de migracion-04-adjuntos.sql): vínculo de cada ticket con un ítem de Monday.
--
-- Guarda, por ticket, el ítem de Monday con el que está vinculado (lo pegó una persona o lo creó la Edge Function «monday-sync»).
-- NovaDesk sigue siendo la fuente de verdad: lo que cambia en el ticket se refleja en Monday, no al revés.
--
--   · Quien puede ver un ticket puede ver su vínculo (el técnico, solo en sus tickets; un usuario inactivo, en ninguno).
--   · Solo un analista o el administrador vinculan o quitan el vínculo. Nadie lo edita (para cambiarlo se quita y se vuelve a vincular).
--   · Un ticket tiene como máximo UN ítem de Monday.
--   · Solo se aceptan enlaces https de monday.com (https://<cuenta>.monday.com/…), para que nadie guarde un enlace a otro sitio.
--   · synced_at / sync_error los escribe solo la Edge Function (clave secreta del servidor); el navegador no puede tocarlos.
--
-- Es una tabla nueva: ejecutarla no cambia nada de lo que ya funciona (QA y Producción comparten esta base, así que se puede
-- ejecutar antes de publicar el código nuevo; la pantalla antigua simplemente no la usa).
-- Es seguro ejecutarla más de una vez. Para deshacerla, ver «Deshacer» al final. Para probarla, docs/pruebas-permisos.sql.

-- ───────────── 1) Tabla de vínculos ─────────────
create table if not exists public.ticket_links (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   text not null references public.tickets(id) on delete cascade,
  provider    text not null default 'monday' check (provider in ('monday')),
  board_id    text not null check (board_id ~ '^[0-9]{1,20}$'),       -- tablero de Monday donde vive el ítem
  item_id     text not null check (item_id  ~ '^[0-9]{1,20}$'),       -- ítem de Monday (el número de «…/pulses/123456»)
  url         text not null check (char_length(url) <= 500 and url ~* '^https://[a-z0-9-]+\.monday\.com/[^[:space:]]*$'),
  linked_by   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  synced_at   timestamptz,                                            -- última vez que NovaDesk actualizó el ítem
  sync_error  text check (char_length(sync_error) <= 300),            -- por qué falló la última sincronización (null = bien)
  unique (ticket_id, provider)
);

alter table public.ticket_links enable row level security;
revoke all on public.ticket_links from anon;
revoke update on public.ticket_links from authenticated;             -- además de no tener política de UPDATE

drop policy if exists links_read on public.ticket_links;
create policy links_read on public.ticket_links for select to authenticated
  using (can_see_ticket(ticket_id));

drop policy if exists links_insert on public.ticket_links;
create policy links_insert on public.ticket_links for insert to authenticated
  with check (app_role() in ('admin', 'analista') and linked_by = auth.uid() and synced_at is null and sync_error is null);

drop policy if exists links_delete on public.ticket_links;
create policy links_delete on public.ticket_links for delete to authenticated
  using (app_role() in ('admin', 'analista'));

-- La fecha la pone el servidor (igual que en comentarios, historial y adjuntos).
drop trigger if exists stamp_created_at on public.ticket_links;
create trigger stamp_created_at before insert on public.ticket_links
for each row execute function public.stamp_created_at();

-- ───────────── Deshacer ─────────────
-- drop table if exists public.ticket_links;
