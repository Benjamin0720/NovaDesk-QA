// NovaDesk · Edge Function «monday-sync»
// Crea en Monday el ítem de un ticket y mantiene ese ítem al día (estado, prioridad, técnico…). Solo va de NovaDesk hacia Monday:
// NovaDesk es la fuente de verdad y Monday sirve para que otras personas (p. ej. gerencia comercial) vean los tickets en un tablero.
//
// Corre en el servidor: el token de Monday vive como secreto de Supabase y NUNCA llega al navegador (js/config.js es público).
// El token de sesión de quien llama se valida aquí mismo (admin.auth.getUser), igual que en «admin-users».
//
// Secretos (ver docs/integracion-monday.md):
//   MONDAY_TOKEN        token de API de Monday (de un usuario dedicado, p. ej. «NovaDesk»)
//   MONDAY_BOARD_ID     número del tablero «Mesa de ayuda» (el de la URL: …/boards/123456789)
//   MONDAY_COLUMNS      JSON que dice a qué columna del tablero va cada dato (ver «columns» abajo)
//   MONDAY_GROUP_ID     (opcional) grupo del tablero donde nacen los ítems nuevos
//   MONDAY_APP_URL      (opcional) URL pública de NovaDesk (Producción); se guarda en la columna «link» como …#I-0001
//   MONDAY_API_VERSION  (opcional) versión de la API de Monday; si falta, usa la estable por defecto de Monday
//
// Acciones (POST con {action, ...}):
//   status                  cualquier usuario activo → {configured}: ¿están los secretos puestos?
//   create  {ticket_id}     analista/administrador   → crea el ítem y guarda el vínculo en ticket_links
//   sync    {ticket_id}     quien puede ver el ticket → actualiza el ítem con los datos actuales del ticket
//   columns                 solo administrador       → lista las columnas del tablero (id, título, tipo) para armar MONDAY_COLUMNS
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Error con un mensaje pensado para mostrarse tal cual en la pantalla (nunca lleva secretos). */
class UserError extends Error {}

const API = 'https://api.monday.com/v2';
const KINDS = ['text', 'status', 'dropdown', 'date', 'link'];
// Datos que NovaDesk puede mandar a Monday; cada uno va a la columna que diga MONDAY_COLUMNS (los que no estén, no se mandan).
const FIELDS = ['id', 'client', 'type', 'priority', 'status', 'assignee', 'created', 'resolved', 'link'];
const TYPE_NAME: Record<string, string> = { R: 'Requerimiento', I: 'Incidente', C: 'Control de cambios' };
const PRIO_NAME: Record<number, string> = { 1: 'Crítica', 2: 'Alta', 3: 'Media', 4: 'Baja' };
const MONDAY_URL = /^https:\/\/[a-z0-9-]+\.monday\.com\/[^\s]*$/i;   // el mismo criterio que la tabla ticket_links

type Col = { id: string; type: string };
type Cfg = { token: string; board: string; cols: Record<string, Col>; group: string | null; appUrl: string | null; version: string | null };
type Ticket = {
  id: string; type: string; title: string; client_id: string; priority: number; status: string;
  assignee_id: string | null; created_by: string; created_at: string; resolved_at: string | null;
};

/** null si faltan el token o el tablero (la integración no está activa). Lanza UserError si MONDAY_COLUMNS está mal escrito. */
function loadConfig(): Cfg | null {
  const token = (Deno.env.get('MONDAY_TOKEN') || '').trim();
  const board = (Deno.env.get('MONDAY_BOARD_ID') || '').trim();
  if (!token || !/^[0-9]{1,20}$/.test(board)) return null;
  const cols: Record<string, Col> = {};
  const raw = Deno.env.get('MONDAY_COLUMNS');
  if (raw) {
    let parsed: Record<string, { id?: unknown; type?: unknown }>;
    try { parsed = JSON.parse(raw); } catch { throw new UserError('El secreto MONDAY_COLUMNS no es un JSON válido.'); }
    for (const f of FIELDS) {
      const c = parsed?.[f];
      if (!c) continue;
      if (typeof c.id !== 'string' || !c.id || typeof c.type !== 'string' || !KINDS.includes(c.type)) {
        throw new UserError(`MONDAY_COLUMNS: la entrada «${f}» necesita "id" y un "type" entre ${KINDS.join(', ')}.`);
      }
      cols[f] = { id: c.id, type: c.type };
    }
  }
  const app = (Deno.env.get('MONDAY_APP_URL') || '').trim();
  return {
    token, board, cols,
    group: (Deno.env.get('MONDAY_GROUP_ID') || '').trim() || null,
    appUrl: /^https:\/\//i.test(app) ? app.replace(/#.*$/, '') : null,
    version: (Deno.env.get('MONDAY_API_VERSION') || '').trim() || null,
  };
}

async function monday(cfg: Cfg, query: string, variables: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: cfg.token };
  if (cfg.version) headers['API-Version'] = cfg.version;
  let res: Response;
  try {
    res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
  } catch {
    throw new UserError('No se pudo conectar con Monday (tiempo agotado o sin conexión).');
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new UserError('Monday rechazó el token. Revisa el secreto MONDAY_TOKEN.');
  if (res.status === 429) throw new UserError('Monday pidió esperar (demasiadas solicitudes). Inténtalo de nuevo en un minuto.');
  const err = body?.errors?.[0]?.message || body?.error_message;
  if (!res.ok || err) throw new UserError('Monday: ' + String(err || 'error ' + res.status).slice(0, 200));
  return body.data;
}

// Las fechas se mandan como día calendario en hora de Chile (si no, un ticket de las 22:00 caería en el día siguiente).
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = (iso: string) => dayFmt.format(new Date(iso));   // «2026-11-18»

/** Da a un dato el formato que Monday espera según el tipo de columna. */
function fmt(kind: string, v: unknown) {
  switch (kind) {
    case 'status': return { label: String(v) };
    case 'dropdown': return { labels: [String(v)] };
    case 'date': return { date: String(v) };
    case 'link': return v;   // {url, text}
    default: return String(v);
  }
}

function buildValues(cfg: Cfg, t: Ticket, clientName: string, assignee: string) {
  const v: Record<string, unknown> = {};
  const put = (field: string, value: unknown) => {
    const c = cfg.cols[field];
    if (c && value != null && value !== '') v[c.id] = fmt(c.type, value);
  };
  put('id', t.id);
  put('client', clientName);
  put('type', TYPE_NAME[t.type]);
  put('priority', PRIO_NAME[t.priority]);
  put('status', t.status);
  put('assignee', assignee || 'Sin asignar');
  put('created', day(t.created_at));
  // Si un ticket se reabre, aquí simplemente deja de mandarse; Monday conserva la fecha anterior (no se borra a propósito).
  if (t.resolved_at) put('resolved', day(t.resolved_at));
  if (cfg.appUrl) put('link', { url: cfg.appUrl + '#' + encodeURIComponent(t.id), text: t.id });
  // OJO: el título del ticket va como nombre del ítem, pero NO la descripción (puede traer datos sensibles de clientes).
  return v;
}
const itemName = (t: Ticket) => `${t.id} · ${t.title}`.slice(0, 255);

/** Clave secreta del proyecto: la «service role» antigua o, en proyectos nuevos, la primera de SUPABASE_SECRET_KEYS (JSON). Nunca sale del servidor. */
function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return String(keys.default || Object.values(keys)[0] || '');
  } catch { return ''; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !caller?.user) return json({ error: 'Sesión inválida. Vuelve a iniciar sesión.' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).maybeSingle();
  if (!me?.active) return json({ error: 'Tu cuenta está inactiva.' }, 403);
  const isAdmin = me.role === 'admin', isStaff = isAdmin || me.role === 'analista';

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Solicitud inválida.' }, 400); }
  const action = String(body.action || '');
  const ticketId = String(body.ticket_id || '');

  try {
    if (action === 'status') {
      let configured = false;
      try { configured = loadConfig() !== null; } catch { /* MONDAY_COLUMNS mal escrito: no está listo */ }
      return json({ configured });
    }

    if (action === 'columns') {
      if (!isAdmin) return json({ error: 'Solo un administrador puede hacer esto.' }, 403);
      const cfg = loadConfig();
      if (!cfg) throw new UserError('Faltan los secretos MONDAY_TOKEN y MONDAY_BOARD_ID.');
      const d = await monday(cfg, 'query($b: [ID!]) { boards(ids: $b) { name columns { id title type } } }', { b: [cfg.board] });
      const b = d?.boards?.[0];
      if (!b) throw new UserError('Monday no encontró el tablero MONDAY_BOARD_ID (¿el token tiene acceso a él?).');
      // Revisa cada dato que NovaDesk manda contra las columnas reales del tablero: que la columna exista y sea del tipo declarado.
      const columns: { id: string; title: string; type: string }[] = b.columns || [];
      const mapping = FIELDS.map((field) => {
        const c = cfg.cols[field];
        if (!c) return { field, estado: 'sin_mapear' };
        const real = columns.find((x) => x.id === c.id);
        if (!real) return { field, id: c.id, tipo: c.type, estado: 'no_existe' };
        return { field, id: c.id, tipo: c.type, titulo: real.title, tipo_real: real.type, estado: real.type === c.type ? 'ok' : 'tipo_distinto' };
      });
      return json({ board: b.name, columns, mapping, appUrl: !!cfg.appUrl, group: !!cfg.group });
    }

    if (action !== 'create' && action !== 'sync') return json({ error: 'Acción desconocida.' }, 400);
    if (!/^[A-Za-z0-9-]{1,30}$/.test(ticketId)) return json({ error: 'Ticket inválido.' }, 400);
    if (action === 'create' && !isStaff) return json({ error: 'Solo un analista o el administrador pueden crear ítems en Monday.' }, 403);

    const cfg = loadConfig();
    if (!cfg) throw new UserError('La integración con Monday no está configurada en el servidor (faltan MONDAY_TOKEN o MONDAY_BOARD_ID).');

    const { data: t } = await admin.from('tickets')
      .select('id, type, title, client_id, priority, status, assignee_id, created_by, created_at, resolved_at')
      .eq('id', ticketId).maybeSingle() as { data: Ticket | null };
    // Misma regla que can_see_ticket() en la base: analista/administrador ven todo; el técnico, lo asignado a él o creado por él.
    if (!t || !(isStaff || t.assignee_id === caller.user.id || t.created_by === caller.user.id)) {
      return json({ error: 'No tienes acceso a ese ticket.' }, 403);
    }
    const { data: cl } = await admin.from('clients').select('name').eq('id', t.client_id).maybeSingle();
    const { data: tech } = t.assignee_id ? await admin.from('profiles').select('name').eq('id', t.assignee_id).maybeSingle() : { data: null };
    const values = buildValues(cfg, t, cl?.name || '', tech?.name || '');
    const { data: link } = await admin.from('ticket_links').select('*').eq('ticket_id', t.id).eq('provider', 'monday').maybeSingle();

    if (action === 'create') {
      if (link) throw new UserError('Este ticket ya tiene un ítem de Monday vinculado.');
      const d = await monday(cfg,
        'mutation($board: ID!, $group: String, $name: String!, $values: JSON) { create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $values, create_labels_if_missing: true) { id url } }',
        { board: cfg.board, group: cfg.group, name: itemName(t), values: JSON.stringify(values) });
      const item = d?.create_item;
      if (!item?.id) throw new UserError('Monday no devolvió el ítem creado.');
      const itemId = String(item.id);

      let url: string | null = typeof item.url === 'string' && MONDAY_URL.test(item.url) ? item.url : null;
      if (!url) {   // versiones de la API sin el campo «url»: se arma con el nombre de la cuenta
        const s = await monday(cfg, '{ me { account { slug } } }').catch(() => null);
        const slug = s?.me?.account?.slug;
        if (typeof slug === 'string' && /^[a-z0-9-]+$/i.test(slug)) url = `https://${slug.toLowerCase()}.monday.com/boards/${cfg.board}/pulses/${itemId}`;
      }
      const undo = () => monday(cfg, 'mutation($i: ID!) { delete_item(item_id: $i) { id } }', { i: itemId }).catch(() => null);
      if (!url) { await undo(); throw new UserError('Monday creó el ítem pero no se pudo obtener su enlace; se deshizo. Vincúlalo a mano pegando su URL.'); }

      const { data: row, error } = await admin.from('ticket_links').insert({
        ticket_id: t.id, provider: 'monday', board_id: cfg.board, item_id: itemId, url,
        linked_by: caller.user.id, synced_at: new Date().toISOString(),
      }).select('*').single();
      if (error) { await undo(); throw new UserError('No se pudo guardar el vínculo (se deshizo el ítem en Monday): ' + error.message); }
      return json({ link: row });
    }

    // action === 'sync'
    if (!link) throw new UserError('Este ticket no está vinculado a Monday.');
    // Un ítem de otro tablero (p. ej. un proyecto) es solo una referencia: no se le pisan las columnas.
    if (link.board_id !== cfg.board) return json({ skipped: 'otro-tablero' });
    try {
      await monday(cfg,
        'mutation($board: ID!, $item: ID!, $values: JSON!) { change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values, create_labels_if_missing: true) { id } }',
        { board: cfg.board, item: link.item_id, values: JSON.stringify({ ...values, name: itemName(t) }) });
    } catch (e) {
      await admin.from('ticket_links').update({ sync_error: (e instanceof UserError ? e.message : 'Error inesperado').slice(0, 300) }).eq('id', link.id);
      throw e;
    }
    const synced_at = new Date().toISOString();
    await admin.from('ticket_links').update({ synced_at, sync_error: null }).eq('id', link.id);
    return json({ ok: true, synced_at });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error('monday-sync', e instanceof Error ? e.message : e);
    return json({ error: 'Error inesperado en el servidor.' }, 500);
  }
});
