/* NovaDesk · DEV sin Supabase.
   Solo se carga cuando la página se abre desde localhost (ver index.html); en QA y Producción (páginas publicadas) este archivo NO se usa.
   Reemplaza al servidor por uno SIMULADO que vive en el navegador: intercepta todo lo que la app le manda a Supabase
   (Auth, tablas, Storage y Edge Functions «admin-users» y «monday-sync») y lo contesta con datos guardados en este navegador
   (localStorage + IndexedDB para los archivos). Nada sale hacia Supabase ni hacia Monday: no gasta cuota de nadie.
   Límites: NO replica los permisos de la base (RLS/disparadores); eso se prueba en QA (Supabase real) con docs/pruebas-permisos.sql.
   Los datos son solo de este navegador; «Restablecer datos de DEV» (panel abajo a la izquierda) vuelve a los datos de ejemplo. */
(() => {
'use strict';
const KEY = 'novadesk.dev.db', VERSION = 1, EMAIL = '@novadesk.local', BOARD = '777', FAKE_HOST = 'dev-simulado.monday.com';
const PASS = 'Dev-Prueba-2026!';   // clave de TODOS los usuarios de ejemplo (solo existe en esta base simulada; NO es la de Producción)
const OWNER = { username: 'blara', name: 'Benjamin Lara' };   // tu cuenta de administrador en DEV (cambia el usuario aquí si en Producción usas otro)
const H = 3600e3, uuid = () => crypto.randomUUID(), nid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const TYPE_NAME = { R: 'Requerimiento', I: 'Incidente', C: 'Control de cambios' }, PRIO_NAME = { 1: 'Crítica', 2: 'Alta', 3: 'Media', 4: 'Baja' };
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = iso => dayFmt.format(new Date(iso));

/* ───────────── Datos de ejemplo ───────────── */
function seed() {
  const now = Date.now(), ago = h => new Date(now - h * H).toISOString();
  const U = (n, username, name, role, skills) => ({ id: nid(n), username, name, role, active: true, skills, must_change: false, last_login: null, created_at: ago(900) });
  const profiles = [U(5, OWNER.username, OWNER.name, 'admin', []), U(1, 'admin', 'Admin DEV', 'admin', []), U(2, 'analista', 'Ana Analista', 'analista', []),
    U(3, 'tecnico1', 'Tomás Técnico', 'tecnico', ['Impresión', 'Hardware / Equipos', 'Software y aplicaciones']),
    U(4, 'tecnico2', 'Camila Redes', 'tecnico', ['Red y conectividad', 'Correo y colaboración', 'Accesos y cuentas'])];
  const clients = [{ id: nid(101), name: 'Bupa', code: 'BUPA', color: '#4da3ff', contact: 'soporte@bupa.example', sla_factor: 0.75, active: true },
    { id: nid(102), name: 'Curico', code: 'CUR', color: '#ff8a4d', contact: 'ti@curico.example', sla_factor: 1, active: true },
    { id: nid(103), name: 'HAH', code: 'HAH', color: '#2dd4a0', contact: 'ti@hah.example', sla_factor: 1, active: true }];
  // T(id, tipo, asunto, descripción, cliente 1-3, prioridad, estado, categoría, técnico (n.º de usuario), creador, horas desde que se creó, extras)
  const T = (id, type, title, description, cl, priority, status, category, assignee, creator, hAgo, extra) => ({ id, type, title, description, client_id: nid(100 + cl), requester: 'Prueba DEV',
    priority, status, category, assignee_id: assignee ? nid(assignee) : null, created_by: nid(creator), ai_confidence: 80, created_at: ago(hAgo), updated_at: ago(Math.max(hAgo - 2, 0.2)),
    resolved_at: null, change_impact: null, change_complexity: null, change_start: null, change_hours: null, change_rollback: null, contact_id: null, ...extra });
  const tickets = [
    T('I-0001', 'I', 'Impresora de farmacia no imprime', 'La impresora de la farmacia muestra error de atasco y no imprime las etiquetas.', 1, 2, 'En curso', 'Impresión', 3, 2, 30),
    T('I-0002', 'I', 'Sin internet en recepción', 'Desde esta mañana no hay conexión a internet en recepción.', 2, 1, 'Asignado', 'Red y conectividad', 4, 2, 3),
    T('I-0003', 'I', 'Correo no sincroniza en el celular', 'El correo corporativo no sincroniza en el celular de la jefatura.', 3, 3, 'Resuelto', 'Correo y colaboración', 4, 2, 60, { resolved_at: ago(5) }),
    T('I-0004', 'I', 'Pantalla del cajero parpadea', 'La pantalla del puesto de caja parpadea cada pocos minutos.', 2, 3, 'Nuevo', 'Hardware / Equipos', null, 2, 1),
    T('R-0001', 'R', 'Crear usuario para nuevo médico', 'Se requiere cuenta de correo y acceso al sistema clínico.', 1, 3, 'Nuevo', 'Accesos y cuentas', null, 2, 6),
    T('R-0002', 'R', 'Instalar Office en 3 equipos', 'Instalar Office en tres equipos nuevos de administración.', 3, 4, 'En espera', 'Software y aplicaciones', 3, 2, 50),
    T('C-0001', 'C', 'Actualizar firmware del firewall', 'Actualizar el firmware del firewall principal a la última versión estable.', 1, 2, 'En evaluación', 'Seguridad', null, 2, 20,
      { change_impact: 3, change_complexity: 2, change_start: new Date(now + 3 * 24 * H).toISOString(), change_hours: 2, change_rollback: 'Restaurar la configuración guardada y volver a la versión anterior.' }),
    T('C-0002', 'C', 'Migrar servidor de archivos', 'Migrar el servidor de archivos a la nueva plataforma.', 3, 3, 'Borrador', 'Servidores e infraestructura', null, 3, 8,
      { change_impact: 2, change_complexity: 3, change_hours: 4, change_rollback: '' })];
  let hid = 1;
  const ticket_history = tickets.map(t => ({ id: hid++, ticket_id: t.id, actor_id: t.created_by, text: 'Ticket creado', to_status: null, created_at: t.created_at }));
  const hist = (ticket_id, h, by, text, to_status) => ticket_history.push({ id: hid++, ticket_id, actor_id: nid(by), text, to_status: to_status || null, created_at: ago(h) });
  hist('I-0001', 29, 2, 'Asignado a Tomás Técnico'); hist('I-0001', 28, 3, 'Estado: Asignado → En curso', 'En curso');
  hist('I-0002', 2.8, 2, 'Estado: Nuevo → Asignado', 'Asignado');
  hist('I-0003', 55, 4, 'Estado: Asignado → En curso', 'En curso'); hist('I-0003', 5, 4, 'Estado: En curso → Resuelto', 'Resuelto');
  hist('R-0002', 40, 3, 'Estado: En curso → En espera', 'En espera');
  const c = (ticket_id, by, h, body, internal) => ({ id: uuid(), ticket_id, author_id: nid(by), body, internal: !!internal, created_at: ago(h) });
  const db = { v: VERSION, t: { clients, profiles, tickets, ticket_comments: [
      c('I-0001', 3, 27, 'Revisé la impresora: hay un atasco en el rodillo. Ya lo estoy desmontando.'),
      c('I-0001', 2, 26, 'Avísame si necesitas repuestos.', true),
      c('I-0002', 4, 2.5, 'Voy en camino a revisar el switch de recepción.')],
    ticket_history, change_approvals: [], ticket_attachments: [], ticket_links: [],
    audit_log: [{ id: 1, actor_id: nid(1), text: 'Datos de ejemplo de DEV creados', created_at: ago(1) }] },
    auth: Object.fromEntries(profiles.map(p => [p.id, { email: p.username + EMAIL, password: PASS }])),
    counters: { R: 2, I: 4, C: 2 }, seq: { history: hid, audit: 2 }, monday: { seq: 9003, items: [] } };
  // Ítems de Monday de ejemplo: dos del tablero «Mesa de ayuda» (777) y uno de otro tablero (solo referencia).
  const link = (ticket_id, board, item, synced) => ({ id: uuid(), ticket_id, provider: 'monday', board_id: board, item_id: item, url: `https://${FAKE_HOST}/boards/${board}/pulses/${item}`,
    linked_by: nid(2), created_at: ago(4), synced_at: synced ? ago(1) : null, sync_error: null });
  db.t.ticket_links.push(link('I-0001', BOARD, '9001', true), link('I-0003', BOARD, '9002', true), link('R-0002', '555', '8002', false));
  db.monday.items.push(mItem(db, 'I-0001', '9001'), mItem(db, 'I-0003', '9002'));
  addPeople(db);
  return db;
}
/* Personas de cada cliente (docs/migracion-06-contactos.sql). [n.º, cliente 1-3, nombre, cargo, correo, teléfono]; el I-0004 queda sin persona a propósito (solicitante escrito a mano). */
const PEOPLE = [[201, 1, 'Marcela Soto', 'Jefa de Farmacia', 'msoto@bupa.example', '+56 2 2345 0101'], [202, 1, 'Rodrigo Pizarro', 'Administrador de la clínica', 'rpizarro@bupa.example', '+56 2 2345 0102'],
  [203, 1, 'Daniela Fuentes', 'Recursos Humanos', 'dfuentes@bupa.example', ''], [204, 2, 'Pablo Araya', 'Encargado de TI', 'paraya@curico.example', '+56 75 255 0201'],
  [205, 2, 'Lorena Ibáñez', 'Recepción', '', '+56 75 255 0202'], [206, 3, 'Felipe Cárcamo', 'Jefe de Operaciones', 'fcarcamo@hah.example', '+56 2 2999 0301'],
  [207, 3, 'Verónica Muñoz', 'Médico jefe', 'vmunoz@hah.example', '']];
const PEOPLE_OF = { 'I-0001': 201, 'I-0002': 205, 'I-0003': 206, 'R-0001': 203, 'R-0002': 206, 'C-0001': 202, 'C-0002': 206 };
/* Agrega las personas de ejemplo a una base de DEV que aún no las tiene (también a la que este navegador ya traía: no se borra nada de lo que hubiera). */
function addPeople(db) {
  if (db.t.client_contacts) return;
  const stamp = new Date().toISOString();
  db.t.client_contacts = PEOPLE.map(([n, cl, name, position, email, phone]) => ({ id: nid(n), client_id: nid(100 + cl), name, position, email: email || null, phone: phone || null, active: true, created_at: stamp }));
  db.t.tickets.forEach(t => {
    const p = db.t.client_contacts.find(x => x.id === nid(PEOPLE_OF[t.id]));
    if (!('contact_id' in t)) t.contact_id = null;
    if (p && p.client_id === t.client_id && !t.contact_id && t.requester === 'Prueba DEV') { t.contact_id = p.id; t.requester = p.name; }
  });
}
function mFields(db, t) {
  const cl = db.t.clients.find(x => x.id === t.client_id), tech = db.t.profiles.find(p => p.id === t.assignee_id);
  const f = { name: `${t.id} · ${t.title}`.slice(0, 255), client: cl ? cl.name : '', type: TYPE_NAME[t.type], priority: PRIO_NAME[t.priority], status: t.status,
    assignee: tech ? tech.name : 'Sin asignar', created: day(t.created_at), link: location.origin + '/#' + t.id, updated: new Date().toISOString() };
  if (t.resolved_at) f.resolved = day(t.resolved_at);   // igual que la función real: nunca borra la fecha de resolución
  return f;
}
const mItem = (db, ticketId, item) => ({ id: item, resolved: '', ...mFields(db, db.t.tickets.find(t => t.id === ticketId)) });

let db; try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
if (!db || db.v !== VERSION) { db = seed(); }
addPeople(db);
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('[DEV] no se pudo guardar', e); } };
/* Tu cuenta de administrador siempre existe, también si este navegador ya tenía datos de DEV de antes (no se borra nada). */
if (!db.t.profiles.some(p => p.username === OWNER.username)) {
  const id = nid(5);
  db.t.profiles.unshift({ id, username: OWNER.username, name: OWNER.name, role: 'admin', active: true, skills: [], must_change: false, last_login: null, created_at: new Date().toISOString() });
  db.auth[id] = { email: OWNER.username + EMAIL, password: PASS };
}
/* Todo usuario de DEV puede entrar con su usuario solo («blara»), sin escribir el correo completo: si a un perfil le falta su cuenta de acceso, se le crea. */
db.t.profiles.forEach(p => { if (!db.auth[p.id]) db.auth[p.id] = { email: p.username + EMAIL, password: PASS }; });
persist();

/* ───────────── Archivos (adjuntos) en IndexedDB ───────────── */
const idbDo = (mode, fn) => new Promise((res, rej) => {
  const o = indexedDB.open('novadesk-dev', 1);
  o.onupgradeneeded = () => o.result.createObjectStore('files');
  o.onerror = () => rej(o.error);
  o.onsuccess = () => { const tx = o.result.transaction('files', mode), rq = fn(tx.objectStore('files')); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); };
});
const idbPut = (k, v) => idbDo('readwrite', s => s.put(v, k)), idbGet = k => idbDo('readonly', s => s.get(k));
const idbDel = k => idbDo('readwrite', s => s.delete(k)), idbClear = () => idbDo('readwrite', s => s.clear());

/* ───────────── Servidor simulado ───────────── */
const json = (b, s = 200) => new Response(b === undefined ? null : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const pgErr = (code, message, s) => json({ code, message, details: null, hint: null }, s);
const profile = id => db.t.profiles.find(p => p.id === id);
const staff = id => ['admin', 'analista'].includes(profile(id)?.role);
const canSee = (id, ticketId) => {   // misma regla que can_see_ticket() en la base
  const p = profile(id); if (!p || !p.active) return false; if (p.role !== 'tecnico') return true;
  const t = db.t.tickets.find(x => x.id === ticketId); return !!t && (t.assignee_id === id || t.created_by === id);
};
const callerOf = h => { const m = /^Bearer dev-token:([0-9a-f-]{36})$/.exec(h.get('Authorization') || ''); return m && db.auth[m[1]] ? m[1] : null; };
const userObj = id => ({ id, aud: 'authenticated', role: 'authenticated', email: db.auth[id].email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: { name: profile(id)?.name }, created_at: profile(id)?.created_at });
const session = id => json({ access_token: 'dev-token:' + id, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'dev-refresh:' + id, user: userObj(id) });
const tempPassword = () => { const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint32Array(12)); return [...r].map(n => set[n % set.length]).join('') + '!7'; };

function auth(method, path, q, body, h) {
  if (path === '/auth/v1/token') {
    if (q.get('grant_type') === 'password') {
      /* La app convierte «blara» en «blara@novadesk.local»; aquí se acepta por el correo guardado o por el usuario del perfil (aunque la cuenta de acceso tenga otro correo). */
      const email = String(body.email || '').toLowerCase(), uname = email.endsWith(EMAIL) ? email.slice(0, -EMAIL.length) : null;
      const id = Object.keys(db.auth).find(i => (db.auth[i].email === email || (uname && profile(i)?.username === uname)) && db.auth[i].password === body.password);
      return id ? session(id) : json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    }
    if (q.get('grant_type') === 'refresh_token') {
      const m = /^dev-refresh:(.+)$/.exec(body.refresh_token || ''); return m && db.auth[m[1]] ? session(m[1]) : json({ code: 400, msg: 'Invalid Refresh Token' }, 400);
    }
  }
  if (path === '/auth/v1/logout') return json(undefined, 204);
  if (path === '/auth/v1/user') {
    const id = callerOf(h); if (!id) return json({ code: 401, msg: 'invalid JWT' }, 401);
    if (method === 'PUT' && body.password) {
      if (body.password === db.auth[id].password) return json({ code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }, 422);
      db.auth[id].password = body.password; persist();
    }
    return json(userObj(id));
  }
  return json({ msg: 'DEV: ruta de Auth no prevista ' + path }, 404);
}

const STAMPED = ['ticket_comments', 'ticket_history', 'change_approvals', 'audit_log', 'ticket_attachments', 'ticket_links', 'client_contacts'];
function rest(method, path, q, body, h, uid) {
  if (!uid) return pgErr('PGRST301', 'JWT inválido o ausente', 401);
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc) {
    const me = profile(uid);
    if (rpc[1] === 'touch_login') { if (me) me.last_login = new Date().toISOString(); persist(); return json(null); }
    if (rpc[1] === 'clear_must_change') { if (me) me.must_change = false; persist(); return json(null); }
    if (rpc[1] === 'next_ticket_id') {
      if (!me || !me.active) return pgErr('P0001', 'usuario no autorizado', 400);
      if (!(body.p_type in db.counters)) return pgErr('P0001', 'tipo de ticket inválido', 400);
      const n = ++db.counters[body.p_type]; persist(); return json(body.p_type + '-' + String(n).padStart(4, '0'));
    }
    return pgErr('PGRST202', 'DEV: función no prevista ' + rpc[1], 404);
  }
  const table = (/^\/rest\/v1\/(\w+)$/.exec(path) || [])[1], rows = table && db.t[table];
  if (!rows) return pgErr('PGRST205', `Could not find the table 'public.${table}' in the schema cache`, 404);
  const me = profile(uid), role = me && me.active ? me.role : null;
  const wantObj = /pgrst\.object/.test(h.get('Accept') || ''), repr = /return=representation/.test(h.get('Prefer') || '');
  const answer = (list, ok) => {
    if (!repr && method !== 'GET') return json(undefined, ok === 201 ? 201 : 204);
    if (wantObj) return list.length === 1 ? json(list[0], ok) : pgErr('PGRST116', 'JSON object requested, multiple (or no) rows returned', 406);
    return json(list, ok);
  };
  const visible = r => table === 'audit_log' ? role === 'admin' : table === 'tickets' ? canSee(uid, r.id) : 'ticket_id' in r ? canSee(uid, r.ticket_id) : table === 'profiles' ? (!!role || r.id === uid) : !!role;
  const filters = [];
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v); if (!m) return pgErr('PGRST100', 'DEV: solo se admite el filtro eq (' + k + ')', 400);
    filters.push([k, m[1]]);
  }
  const match = r => filters.every(([k, v]) => String(r[k]) === v);
  const deny = () => pgErr('42501', `new row violates row-level security policy for table "${table}"`, 403);

  if (method === 'GET') {
    let out = rows.filter(r => visible(r) && match(r));
    const order = q.getAll('order').join(',').split(',').filter(Boolean).map(s => s.split('.'));
    out.sort((a, b) => { for (const [c, d] of order) { if (a[c] === b[c]) continue; return ((a[c] ?? '') < (b[c] ?? '') ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
    const off = +q.get('offset') || 0, lim = q.has('limit') ? +q.get('limit') : out.length;
    return answer(out.slice(off, off + lim), 200);
  }
  if (method === 'POST') {
    const items = (Array.isArray(body) ? body : [body]).map(x => ({ ...x })), upsert = /merge-duplicates/.test(h.get('Prefer') || ''), now = Date.now(), added = [];
    if (table === 'clients' && role !== 'admin') return deny();
    if (table === 'client_contacts' && !['admin', 'analista'].includes(role)) return deny();   // solo analista o administrador agregan personas
    const fkContact = (contactId, clientId) => !contactId || db.t.client_contacts.some(p => p.id === contactId && p.client_id === clientId);   // llave compuesta tickets_contact_fk
    for (const [i, it] of items.entries()) {
      if (table === 'client_contacts' && (!String(it.name || '').trim() || !db.t.clients.some(c => c.id === it.client_id))) return pgErr('23514', 'new row for relation "client_contacts" violates check constraint', 400);
      if (table === 'tickets' && !fkContact(it.contact_id, it.client_id)) return pgErr('23503', 'insert or update on table "tickets" violates foreign key constraint "tickets_contact_fk"', 409);
      if (table === 'ticket_links') {
        if (!['admin', 'analista'].includes(role) || it.linked_by !== uid || it.synced_at || it.sync_error) return deny();
        if (!/^https:\/\/[a-z0-9-]+\.monday\.com\/\S*$/i.test(it.url || '') || it.url.length > 500) return pgErr('23514', 'new row for relation "ticket_links" violates check constraint', 400);
        if (rows.some(r => r.ticket_id === it.ticket_id && r.provider === (it.provider || 'monday'))) return pgErr('23505', 'duplicate key value violates unique constraint "ticket_links_ticket_id_provider_key"', 409);
        it.provider = it.provider || 'monday'; it.synced_at = null; it.sync_error = null;
      }
      if (table === 'tickets' && (it.created_by !== uid || !canSee(uid, it.id) && role === 'tecnico' && it.assignee_id && it.assignee_id !== uid)) return deny();
      if (table === 'audit_log' && it.actor_id !== uid) return deny();
      if (STAMPED.includes(table)) it.created_at = new Date(now + i).toISOString();   // la fecha la pone el servidor
      if (table === 'tickets') { it.created_at = new Date(now).toISOString(); it.updated_at = it.created_at; }
      if (table === 'ticket_history') it.id = db.seq.history++;
      else if (table === 'audit_log') it.id = db.seq.audit++;
      else if (!it.id && !['clients', 'profiles', 'tickets'].includes(table)) it.id = uuid();
      const dup = rows.find(r => r.id === it.id);
      if (dup && upsert) { Object.assign(dup, it); added.push(dup); continue; }
      if (dup) return pgErr('23505', `duplicate key value violates unique constraint "${table}_pkey"`, 409);
      rows.push(it); added.push(it);
    }
    persist(); return answer(added, 201);
  }
  if (method === 'PATCH') {
    if (table === 'profiles' && role !== 'admin') return answer([], 200);
    if (table === 'client_contacts' && !['admin', 'analista'].includes(role)) return answer([], 200);
    const hit = rows.filter(r => visible(r) && match(r));
    if (table === 'tickets' && body.contact_id && hit.some(r => !db.t.client_contacts.some(p => p.id === body.contact_id && p.client_id === r.client_id))) return pgErr('23503', 'insert or update on table "tickets" violates foreign key constraint "tickets_contact_fk"', 409);
    if (['ticket_links', 'ticket_attachments', 'ticket_comments', 'ticket_history', 'audit_log', 'change_approvals'].includes(table)) return answer([], 200);   // nadie los edita
    hit.forEach(r => { Object.assign(r, body); if (table === 'tickets') r.updated_at = new Date().toISOString(); });
    persist(); return answer(hit, 200);
  }
  if (method === 'DELETE') {
    const hit = rows.filter(r => visible(r) && match(r) && (table === 'ticket_links' ? ['admin', 'analista'].includes(role)
      : table === 'ticket_attachments' ? (r.uploader_id === uid || ['admin', 'analista'].includes(role)) : table === 'tickets' ? role === 'admin' : false));
    hit.forEach(r => rows.splice(rows.indexOf(r), 1));
    persist(); return answer(hit, 200);
  }
  return pgErr('PGRST000', 'DEV: método no previsto', 405);
}

/* Edge Functions simuladas */
function adminUsers(uid, body) {
  if (profile(uid)?.role !== 'admin') return json({ error: 'Solo un administrador puede hacer esto.' }, 403);
  const audit = text => db.t.audit_log.push({ id: db.seq.audit++, actor_id: uid, text, created_at: new Date().toISOString() });
  if (body.action === 'create') {
    const name = String(body.name || '').trim(), login = String(body.login || '').trim().toLowerCase(), email = login.includes('@') ? login : login + EMAIL, username = email.split('@')[0];
    if (!name) return json({ error: 'Falta el nombre.' }, 400);
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'Usuario inválido (minúsculas, números, punto o guion; 3 a 30 caracteres).' }, 400);
    if (!['admin', 'analista', 'tecnico'].includes(body.role)) return json({ error: 'Rol inválido.' }, 400);
    if (db.t.profiles.some(p => p.username === username)) return json({ error: 'Ya existe un usuario con ese nombre.' }, 409);
    const id = uuid(), password = tempPassword();
    db.auth[id] = { email, password };
    db.t.profiles.push({ id, username, name, role: body.role, active: true, skills: body.role === 'tecnico' ? (body.skills || []) : [], must_change: true, last_login: null, created_at: new Date().toISOString() });
    audit(`Creó al usuario ${name} (${body.role})`); persist();
    return json({ id, username, login: email.endsWith(EMAIL) ? username : email, password });
  }
  if (body.action === 'reset') {
    const p = profile(body.id); if (!p) return json({ error: 'Usuario no encontrado.' }, 404);
    const password = tempPassword(); db.auth[p.id].password = password; p.must_change = true;
    audit('Restableció la contraseña de ' + p.name); persist();
    return json({ login: db.auth[p.id].email.endsWith(EMAIL) ? p.username : db.auth[p.id].email, password });
  }
  return json({ error: 'Acción desconocida.' }, 400);
}
/* «monday-sync» simulada: el «Monday» es un tablero guardado en este navegador (dev/monday.html lo muestra). Mismas reglas que la función real. */
function mondaySync(uid, body) {
  const me = profile(uid), a = body.action;
  if (!me || !me.active) return json({ error: 'Tu cuenta está inactiva.' }, 403);
  if (a === 'status') return json({ configured: true });
  if (a === 'columns') {   // igual que la función real: devuelve las columnas del tablero y revisa el mapeo (aquí todo está bien)
    if (me.role !== 'admin') return json({ error: 'Solo un administrador puede hacer esto.' }, 403);
    const columns = [['name', 'Ticket', 'name'], ['text_id', 'N.º', 'text'], ['status_cliente', 'Cliente', 'status'], ['status_tipo', 'Tipo', 'status'], ['status_prioridad', 'Prioridad', 'status'],
      ['status_estado', 'Estado', 'status'], ['text_tecnico', 'Técnico', 'text'], ['date_creado', 'Creado', 'date'], ['date_resuelto', 'Resuelto', 'date'], ['link_ticket', 'Enlace', 'link']].map(([id, title, type]) => ({ id, title, type }));
    const campos = { id: 'text_id', client: 'status_cliente', type: 'status_tipo', priority: 'status_prioridad', status: 'status_estado', assignee: 'text_tecnico', created: 'date_creado', resolved: 'date_resuelto', link: 'link_ticket' };
    const mapping = Object.entries(campos).map(([field, id]) => { const c = columns.find(x => x.id === id); return { field, id, tipo: c.type, titulo: c.title, tipo_real: c.type, estado: 'ok' }; });
    return json({ board: 'Mesa de ayuda (simulado)', columns, mapping, appUrl: true, group: false });
  }
  if (a !== 'create' && a !== 'sync') return json({ error: 'Acción desconocida.' }, 400);
  if (a === 'create' && !staff(uid)) return json({ error: 'Solo un analista o el administrador pueden crear ítems en Monday.' }, 403);
  const t = db.t.tickets.find(x => x.id === body.ticket_id);
  if (!t || !canSee(uid, t.id)) return json({ error: 'No tienes acceso a ese ticket.' }, 403);
  const link = db.t.ticket_links.find(l => l.ticket_id === t.id);
  if (a === 'create') {
    if (link) return json({ error: 'Este ticket ya tiene un ítem de Monday vinculado.' }, 400);
    const item = String(db.monday.seq++); db.monday.items.push(mItem(db, t.id, item));
    const row = { id: uuid(), ticket_id: t.id, provider: 'monday', board_id: BOARD, item_id: item, url: `https://${FAKE_HOST}/boards/${BOARD}/pulses/${item}`, linked_by: uid,
      created_at: new Date().toISOString(), synced_at: new Date().toISOString(), sync_error: null };
    db.t.ticket_links.push(row); persist(); return json({ link: row });
  }
  if (!link) return json({ error: 'Este ticket no está vinculado a Monday.' }, 400);
  if (link.board_id !== BOARD) return json({ skipped: 'otro-tablero' });
  const it = db.monday.items.find(i => i.id === link.item_id);
  if (!it) { link.sync_error = 'Monday: el ítem no existe en el tablero simulado'; persist(); return json({ error: link.sync_error }, 400); }
  Object.assign(it, mFields(db, t)); link.synced_at = new Date().toISOString(); link.sync_error = null; persist();
  return json({ ok: true, synced_at: link.synced_at });
}
function fn(path, body, uid) {
  if (!uid) return json({ code: 401, message: 'Invalid JWT' }, 401);
  const name = path.split('/').pop();
  if (name === 'admin-users') return adminUsers(uid, body || {});
  if (name === 'monday-sync') return mondaySync(uid, body || {});
  return json({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404);
}

/* Storage simulado (bucket «ticket-files») */
async function storage(method, path, body, h, uid) {
  if (!uid) return json({ statusCode: '401', error: 'Unauthorized', message: 'JWT inválido' }, 401);
  const up = /^\/storage\/v1\/object\/ticket-files\/(.+)$/.exec(path), sign = /^\/storage\/v1\/object\/sign\/ticket-files\/(.+)$/.exec(path);
  if (method === 'POST' && up) {
    const p = decodeURIComponent(up[1]), ficha = db.t.ticket_attachments.find(a => a.storage_path === p && a.uploader_id === uid);
    if (!ficha) return json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403);   // Storage solo acepta archivos con ficha
    await idbPut(p, body instanceof FormData ? body.get('') : body);
    return json({ Key: 'ticket-files/' + p, Id: uuid() });
  }
  if (method === 'POST' && sign) {
    const p = decodeURIComponent(sign[1]);
    if (!canSee(uid, p.split('/')[0])) return json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
    return json({ signedURL: '/object/sign/ticket-files/' + p + '?token=dev' });   // el cliente de Storage le aplica encodeURI
  }
  if (method === 'DELETE' && path === '/storage/v1/object/ticket-files') {
    const gone = (body && body.prefixes) || [];
    for (const p of gone) await idbDel(p);
    return json(gone.map(name => ({ name })));
  }
  return json({ statusCode: '404', error: 'not_found', message: 'DEV: ruta de Storage no prevista ' + path }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.hostname.endsWith('.supabase.co')) return realFetch(input, init);   // todo lo que va a Supabase se contesta aquí, nada sale a internet
  await new Promise(r => setTimeout(r, 30));
  try {
    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase(), h = new Headers(init.headers || {}), path = url.pathname;
    let body = init.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* texto plano */ } }
    const uid = callerOf(h);
    if (path.startsWith('/auth/v1/')) return auth(method, path, url.searchParams, body || {}, h);
    if (path.startsWith('/rest/v1/')) return rest(method, path, url.searchParams, body || {}, h, uid);
    if (path.startsWith('/functions/v1/')) return fn(path, body, uid);
    if (path.startsWith('/storage/v1/')) return await storage(method, path, body, h, uid);
    return json({ message: 'DEV: ruta no prevista ' + path }, 404);
  } catch (e) { console.error('[DEV]', e); return json({ message: 'DEV: error interno: ' + e.message }, 500); }
};

/* Los enlaces de ítems «Monday» simulados abren el tablero simulado (nunca un sitio real); los adjuntos se abren desde IndexedDB. */
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
  let u; try { u = new URL(a.href); } catch { return; }
  if (u.hostname === FAKE_HOST) { e.preventDefault(); window.open('/dev/monday.html#' + ((/pulses\/(\d+)/.exec(u.pathname) || [])[1] || ''), '_blank'); }
}, true);
const nativeClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  const m = /\/storage\/v1\/object\/sign\/ticket-files\/([^?]+)/.exec(this.href || '');
  if (!m) return nativeClick.call(this);
  const p = decodeURIComponent(m[1]), dl = new URL(this.href).searchParams.get('download');
  idbGet(p).then(blob => {
    if (!blob) return alert('DEV: ese archivo ya no está guardado en este navegador.');
    const url = URL.createObjectURL(blob);
    if (dl === null) return void window.open(url, '_blank');
    const a = document.createElement('a'); a.href = url; a.download = dl || p.split('/').pop(); nativeClick.call(a);
  });
};

/* Panel de DEV (abajo a la izquierda): entrar rápido con cada rol, ver el Monday simulado y restablecer los datos. */
addEventListener('DOMContentLoaded', () => {
  const d = document.createElement('details'); d.id = 'devPanel';
  d.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#151530;color:#fff;border:1px solid #8b7bff;border-radius:12px;padding:8px 10px;font:12px/1.4 system-ui,sans-serif;max-width:250px;box-shadow:0 6px 24px #0008';
  const btn = 'background:#26264d;color:#fff;border:1px solid #3b3b73;border-radius:8px;padding:5px 8px;cursor:pointer;font:inherit;text-align:left';
  d.innerHTML = `<summary style="cursor:pointer;font-weight:600">🧪 DEV · datos simulados</summary><div style="margin-top:8px;display:grid;gap:6px">
    <div data-dev-aviso style="display:none;background:#5a2a00;border:1px solid #ffb84d;border-radius:8px;padding:6px 8px">⚠️ Esa clave no sirve en DEV. Usa uno de estos botones.</div>
    <div style="opacity:.8">Sin Supabase: todo vive en este navegador. Tu correo y tu clave reales NO existen aquí: entra con un botón, o con el usuario solo (p. ej. «${OWNER.username}», sin el correo completo) y la clave de DEV, que ya viene escrita en el formulario.</div>
    ${[['👑 ' + OWNER.name + ' (tu cuenta)', OWNER.username], ['👑 Admin DEV', 'admin'], ['🧭 Analista', 'analista'], ['🛠️ Técnico 1', 'tecnico1'], ['🛠️ Técnico 2', 'tecnico2']].map(([l, u]) => `<button style="${btn}" data-dev-login="${u}">${l}</button>`).join('')}
    <a href="/dev/monday.html" target="_blank" style="${btn};text-decoration:none;color:#fff">📋 Ver el Monday simulado ↗</a>
    <button style="${btn}" data-dev-reset>♻️ Restablecer datos de DEV</button></div>`;
  d.addEventListener('click', async e => {
    const lg = e.target.closest('[data-dev-login]');
    if (lg) {
      const f = document.getElementById('authForm'); if (!f) return alert('Cierra la sesión actual para entrar con otro usuario.');
      f.querySelector('[name=username]').value = lg.dataset.devLogin; f.querySelector('[name=password]').value = PASS; f.requestSubmit();
    }
    if (e.target.closest('[data-dev-reset]') && confirm('¿Borrar todos los datos de DEV de este navegador y volver a los de ejemplo?')) {
      localStorage.removeItem(KEY); try { sessionStorage.clear(); await idbClear(); } catch { /* sin archivos */ } location.reload();
    }
  });
  document.body.appendChild(d);
  /* En la pantalla de acceso el panel se abre solo (y avisa si falla un ingreso); al entrar a la app se cierra. */
  const app = document.getElementById('app'), aviso = d.querySelector('[data-dev-aviso]');
  let enLogin = null;
  const vigilar = () => {
    const ahora = !!document.getElementById('authForm');
    if (ahora !== enLogin) {
      enLogin = ahora; d.open = ahora;
      /* Al aparecer el formulario de acceso se precarga tu usuario y la clave de DEV: basta con «Ingresar» (se pueden cambiar a mano). */
      const f = document.getElementById('authForm'), u = f && f.querySelector('[name=username]'), p = f && f.querySelector('[name=password]');
      if (u && p && !u.value && !p.value) { u.value = OWNER.username; p.value = PASS; }
    }
    aviso.style.display = ahora && /incorrectos/.test(app.innerText) ? 'block' : 'none';
  };
  if (app) { new MutationObserver(vigilar).observe(app, { childList: true, subtree: true }); vigilar(); }
});
})();
