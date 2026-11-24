-- NovaDesk · migración 6 (ejecutar DESPUÉS de migracion-05-monday.sql): personas de cada cliente («contactos»).
--
-- Cada cliente puede tener su lista de personas (nombre, cargo o área, correo y teléfono). Al crear un ticket se elige quién
-- es el solicitante entre las personas de ese cliente, y el ticket queda ligado a esa persona (se puede ver «todos los tickets de X»).
-- Si el cliente aún no tiene personas, o la persona no está registrada, el solicitante se sigue escribiendo a mano como hasta ahora.
--
--   · Todo usuario activo ve las personas (las necesita para crear tickets); un usuario inactivo no ve nada.
--   · Solo un analista o el administrador agregan o editan personas. Nadie las borra: se desactivan (así no se pierde el historial
--     de quién pidió cada ticket). Una persona inactiva deja de ofrecerse al crear tickets nuevos, pero sus tickets la conservan.
--   · Un ticket solo puede apuntar a una persona de SU cliente (lo exige la base con una llave foránea compuesta).
--   · El técnico elige la persona al crear el ticket, pero después no la cambia (igual que el solicitante): lo hace un analista o el administrador.
--   · El nombre del solicitante sigue guardándose también como texto en tickets.requester: los tickets antiguos, Power BI (bi.tickets)
--     y todo lo que ya leía ese campo siguen funcionando sin cambios.
--
-- Es una tabla nueva y una columna opcional: ejecutarla no cambia nada de lo que ya funciona (se puede ejecutar antes de publicar
-- el código nuevo; la pantalla antigua simplemente no la usa).
-- Es seguro ejecutarla más de una vez. Para deshacerla, ver «Deshacer» al final. Para probarla, docs/pruebas-permisos.sql.

-- ───────────── 1) Tabla de personas ─────────────
create table if not exists public.client_contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  position    text check (char_length(position) <= 120),                -- cargo o área (opcional)
  email       text check (char_length(email) <= 200),
  phone       text check (char_length(phone) <= 60),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, client_id)                                                -- lo necesita la llave compuesta de tickets
);
create index if not exists client_contacts_client_idx on public.client_contacts (client_id, name);

alter table public.client_contacts enable row level security;
revoke all on public.client_contacts from anon;
revoke delete on public.client_contacts from authenticated;            -- además de no tener política de DELETE

drop policy if exists contacts_read on public.client_contacts;
create policy contacts_read on public.client_contacts for select to authenticated
  using (app_role() is not null);

drop policy if exists contacts_insert on public.client_contacts;
create policy contacts_insert on public.client_contacts for insert to authenticated
  with check (app_role() in ('admin', 'analista'));

drop policy if exists contacts_update on public.client_contacts;
create policy contacts_update on public.client_contacts for update to authenticated
  using (app_role() in ('admin', 'analista')) with check (app_role() in ('admin', 'analista'));

-- La fecha de alta la pone el servidor (igual que en comentarios, historial y adjuntos).
drop trigger if exists stamp_created_at on public.client_contacts;
create trigger stamp_created_at before insert on public.client_contacts
for each row execute function public.stamp_created_at();

-- ───────────── 2) El ticket apunta (opcionalmente) a una persona de su cliente ─────────────
alter table public.tickets add column if not exists contact_id uuid;

-- Llave compuesta: (persona, cliente del ticket) debe existir en client_contacts. Si contact_id es null no se revisa nada.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_contact_fk') then
    alter table public.tickets add constraint tickets_contact_fk
      foreign key (contact_id, client_id) references public.client_contacts (id, client_id);
  end if;
end $$;
create index if not exists tickets_contact_idx on public.tickets (contact_id);

-- ───────────── 3) El técnico no cambia la persona de un ticket ─────────────
-- Es la misma función de migracion-03-permisos.sql con una condición más (contact_id junto a requester).
create or replace function public.tickets_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  r     text    := app_role();
  staff boolean := coalesce(r in ('admin', 'analista'), false);
  ok    boolean;
begin
  if auth.uid() is null then return new; end if;
  if r is null then raise exception 'Tu cuenta está inactiva.' using errcode = '42501'; end if;

  if new.id is distinct from old.id or new.type is distinct from old.type
     or new.client_id is distinct from old.client_id or new.created_by is distinct from old.created_by then
    raise exception 'No se puede cambiar el número, el tipo, el cliente ni el autor de un ticket.' using errcode = '42501';
  end if;

  if not staff then
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.requester is distinct from old.requester or new.contact_id is distinct from old.contact_id
       or new.priority is distinct from old.priority
       or new.category is distinct from old.category or new.ai_confidence is distinct from old.ai_confidence then
      raise exception 'Tu rol no puede cambiar el asunto, la descripción, el solicitante, la prioridad ni la categoría.' using errcode = '42501';
    end if;
    if new.assignee_id is distinct from old.assignee_id
       and not (old.assignee_id is null and new.assignee_id = auth.uid()) then
      raise exception 'Tu rol solo puede tomar un ticket sin asignar; reasignar lo hace un analista o el administrador.' using errcode = '42501';
    end if;
    if old.status <> 'Borrador' and (
          coalesce(new.change_impact, 2)     is distinct from coalesce(old.change_impact, 2)
       or coalesce(new.change_complexity, 2) is distinct from coalesce(old.change_complexity, 2)
       or coalesce(new.change_hours, 2)      is distinct from coalesce(old.change_hours, 2)
       or coalesce(new.change_rollback, '')  is distinct from coalesce(old.change_rollback, '')
       or date_trunc('milliseconds', new.change_start) is distinct from date_trunc('milliseconds', old.change_start)) then
      raise exception 'El plan del cambio solo se edita en Borrador; después lo gestiona un analista.' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    -- Mismo flujo que transitions() en js/novadesk.js; «staff» = administrador o analista.
    ok := case when new.type = 'C' then
             (old.status = 'Borrador'      and new.status = 'En evaluación')
          or (old.status = 'En evaluación' and new.status in ('Aprobado', 'Rechazado') and staff)
          or (old.status = 'Aprobado'      and new.status = 'Programado' and staff)
          or (old.status = 'Programado'    and new.status = 'Implementando')
          or (old.status = 'Implementando' and new.status in ('Implementado', 'Programado'))
          or (old.status = 'Implementado'  and new.status = 'Cerrado' and staff)
          or (old.status = 'Rechazado'     and new.status = 'Borrador' and staff)
        else
             (old.status = 'Nuevo'     and new.status = 'Asignado' and staff)
          or (old.status = 'Nuevo'     and new.status = 'En curso' and not staff)
          or (old.status = 'Asignado'  and new.status = 'En curso')
          or (old.status = 'En curso'  and new.status in ('En espera', 'Resuelto'))
          or (old.status = 'En espera' and new.status = 'En curso')
          or (old.status = 'Resuelto'  and new.status = 'Cerrado' and staff)
          or (old.status = 'Resuelto'  and new.status = 'En curso')
          or (old.status = 'Cerrado'   and new.status = 'En curso' and staff)
        end;
    if not coalesce(ok, false) then
      raise exception 'Ese cambio de estado (% → %) no está permitido para tu rol o por el flujo.', old.status, new.status using errcode = '42501';
    end if;
    if new.status in ('Resuelto', 'Implementado') then new.resolved_at := now();
    elsif new.status in ('En curso', 'Implementando') then new.resolved_at := null;
    else new.resolved_at := old.resolved_at;
    end if;
  else
    new.resolved_at := old.resolved_at;
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

-- (create or replace conserva los permisos de la función, pero se repite por si acaso)
revoke execute on function public.tickets_guard() from public, anon, authenticated;

-- ───────────── Deshacer ─────────────
-- alter table public.tickets drop constraint if exists tickets_contact_fk;
-- alter table public.tickets drop column if exists contact_id;
-- drop table if exists public.client_contacts;
-- Después, volver a ejecutar docs/migracion-03-permisos.sql (restaura tickets_guard sin contact_id).
