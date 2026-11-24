# Guía del código de NovaDesk

Para quien tenga que **mantener, explicar o modificar** NovaDesk sin haber escrito sus líneas. No hace falta ser programador experto: la idea es que puedas
responder «¿qué hace esto y dónde está?» y saber **qué tocar** (y qué probar después) cuando algo cambie.

> Esta guía se escribió leyendo el código tal como está en el repositorio. Cita **nombres de funciones y secciones**, no números de línea
> (las líneas se mueven con cada cambio): busca el nombre con Ctrl + F en el archivo.

**Contenido**
1. [Qué es y cómo está armado](#1-qué-es-y-cómo-está-armado)
2. [Mapa de archivos](#2-mapa-de-archivos)
3. [Cómo arranca la página](#3-cómo-arranca-la-página)
4. [Cómo viaja la información (el corazón de la app)](#4-cómo-viaja-la-información)
5. [`js/novadesk.js` sección por sección](#5-jsnovadeskjs-sección-por-sección)
6. [Nova: cómo clasifica un ticket](#6-nova-cómo-clasifica-un-ticket)
7. [La base de datos](#7-la-base-de-datos)
8. [Las funciones del servidor (Edge Functions)](#8-las-funciones-del-servidor-edge-functions)
9. [Seguridad: dónde se aplica cada regla](#9-seguridad-dónde-se-aplica-cada-regla)
10. [Entornos y publicación (DEV → QA → Producción)](#10-entornos-y-publicación)
11. [Recetas: «quiero cambiar X, ¿qué toco?»](#11-recetas-quiero-cambiar-x-qué-toco)
12. [Cuando algo falla: síntoma → causa probable](#12-cuando-algo-falla)
13. [Límites conocidos y cosas por revisar](#13-límites-conocidos-y-cosas-por-revisar)
14. [Glosario](#14-glosario)

---

## 1. Qué es y cómo está armado

NovaDesk es una mesa de ayuda con tres tipos de ticket: **R** (requerimiento), **I** (incidente) y **C** (control de cambios), con roles
(Administrador, Analista, Técnico), SLA por prioridad y cliente, adjuntos, un «asistente» local llamado **Nova** y vínculo opcional con **Monday**.

Son **tres piezas**:

```
┌──────────────────────────────┐        ┌────────────────────────────────────────────┐
│  NAVEGADOR (lo que ve el      │        │  SUPABASE (el «servidor»)                  │
│  usuario)                     │        │                                            │
│  index.html + css + js        │ ─────► │  · Auth      → usuarios y contraseñas      │
│  (sin build, sin framework)   │ HTTPS  │  · PostgreSQL → tickets, usuarios, reglas  │
│                               │ ◄───── │  · Storage   → archivos adjuntos           │
│  Aquí corre también Nova      │        │  · Edge Functions → admin-users,           │
│  (clasificación de tickets)   │        │                     monday-sync            │
└──────────────────────────────┘        └───────────────────┬────────────────────────┘
        ▲                                                    │ solo desde el servidor
        │ en DEV (localhost) este archivo finge ser          ▼
        │ Supabase y Monday: dev/backend.js         API de Monday (tablero «Mesa de ayuda»)
```

- **El navegador** guarda **todo en memoria** mientras trabajas y manda a Supabase solo lo que cambió. No hay servidor propio: la página son archivos estáticos
  que se publican en GitHub Pages.
- **Supabase** es un servicio ya hecho que junta base de datos PostgreSQL, login, almacenamiento de archivos y funciones de servidor. Lo importante:
  **las reglas de seguridad viven en la base de datos**, no en la página (ver [sección 9](#9-seguridad-dónde-se-aplica-cada-regla)).
- **Monday** solo recibe datos **desde el servidor** (la función `monday-sync`). El token de Monday nunca llega al navegador.

Tecnologías: HTML, CSS y JavaScript «puro» (un solo archivo grande, `js/novadesk.js`); PostgreSQL; TypeScript para las dos funciones del servidor.
Una librería externa en el navegador: `supabase-js`, cargada desde jsDelivr (CDN) en `index.html`.

---

## 2. Mapa de archivos

| Archivo | Qué es | Cuándo lo tocarías |
|---|---|---|
| `index.html` | La única página. Carga, en orden: `dev/backend.js` (**solo** en localhost) → `supabase-js` (CDN, con huella de integridad) → `js/config.js` → `js/novadesk.js`. | Casi nunca. |
| `css/novadesk.css` | Todos los estilos. Colores por variables (`:root`) con tema oscuro y claro (`[data-theme="light"]`). | Cambios de apariencia. |
| `js/config.js` | Decide **en qué entorno** está la página (DEV, QA, Producción) según la dirección y entrega la URL y la clave pública de Supabase de ese entorno. | Al agregar un entorno o cambiar de servidor. |
| `js/novadesk.js` | **Toda la aplicación** (≈1100 líneas): datos, login, Nova, SLA, vistas, acciones, Monday, adjuntos. | Casi cualquier cambio de pantalla o de lógica. |
| `dev/backend.js` | Simula Supabase y Monday **dentro del navegador** para trabajar en DEV sin gastar nada. Solo se usa en `localhost`. | Si cambias la forma de hablar con Supabase, hay que reflejarlo aquí. |
| `dev/monday.html` | Tablero de Monday «de mentira» que se abre desde DEV. | Rara vez. |
| `docs/schema.sql` | Esquema base de la base de datos (tablas, funciones, RLS, vistas para Power BI). | No se edita: los cambios van en una migración nueva. |
| `docs/migracion-02-app.sql` … `migracion-06-contactos.sql` | Cambios sucesivos: creación de perfil al registrar usuario (02), permisos reforzados (03), adjuntos (04), vínculo con Monday (05), personas de cada cliente (06). Se ejecutan **en orden**. | Al agregar una migración nueva (número siguiente). |
| `docs/pruebas-permisos.sql` | Batería de pruebas de los permisos con usuarios falsos. No deja nada guardado. | Se ejecuta después de **cualquier** cambio en las reglas de la base. |
| `supabase/functions/admin-users/index.ts` | Crea usuarios y restablece contraseñas (solo administrador). | Si cambia cómo se crean usuarios. |
| `supabase/functions/monday-sync/index.ts` | Crea y actualiza el ítem de Monday de un ticket; revisa la conexión. | Si cambia qué se manda a Monday. |
| `scripts/flujo.ps1`, `flujo.cmd`, `pre-push` | El flujo de publicación DEV → QA → Producción y el «candado» que lo hace cumplir. | Si cambia dónde se publica. |
| `docs/*.md` | Documentación. `plan-base-de-datos.md` es el **diseño inicial** (histórico: lo vigente son las migraciones). | Al documentar cambios. |
| `.gitignore` / `.claude/` | `.claude/` es local (servidor de pruebas en el puerto 8123) y no se sube a git. | — |

Qué **no** hay: no hay `package.json`, ni `node_modules`, ni paso de compilación. Lo que ves en la carpeta es exactamente lo que se publica.

---

## 3. Cómo arranca la página

1. El navegador abre `index.html`. Si la dirección es `localhost`, carga primero `dev/backend.js` (el Supabase de mentira).
2. Carga `supabase-js` y luego `js/config.js`, que mira la dirección y deja listos dos valores globales: `window.NOVADESK_ENV` (`dev`, `qa`, `produccion` o nada)
   y `window.NOVADESK_CONFIG` (`{url, key, env}`). **Una dirección que no esté registrada no recibe configuración**: la página no se conecta a ninguna base.
3. `js/novadesk.js` crea el cliente de Supabase (`sb`) con esa configuración. La sesión se guarda en `sessionStorage`: **se pierde al cerrar la pestaña**.
4. `boot()` decide qué mostrar:
   - hay sesión, es de la misma persona y su último movimiento fue hace **menos de 15 min** (`IDLE`) → `enter()` (entra directo);
   - si no → pantalla de login.
5. `enter(id)` lee tu perfil (`profiles`); si no existe o está **inactivo**, cierra la sesión; si no, `fetchData()` descarga las tablas **que la base te deja ver**
   (el técnico solo recibe sus tickets) y `applyData()` las convierte al formato interno.
6. Si la dirección trae `#I-0001`, abre ese ticket (es el enlace que NovaDesk guarda en Monday).

El **usuario** de la pantalla (`nombre.apellido`) es en realidad un correo interno `nombre.apellido@novadesk.local` (constante `EMAIL_DOMAIN`):
Supabase Auth trabaja con correos. También se puede entrar escribiendo el correo completo.

---

## 4. Cómo viaja la información

Esta es la idea que más ayuda a entender el código. **No hay un framework**: la app mantiene todo en variables y redibuja la pantalla completa cada vez.

**Las variables centrales** (al inicio de `js/novadesk.js`):
- `S` = el **estado en memoria**: `S.tickets`, `S.users`, `S.clients`, `S.audit`, `S.session` (quién soy). Cada ticket lleva dentro sus comentarios, historial,
  adjuntos, aprobaciones y vínculo de Monday.
- `ui` = el estado de la **pantalla**: qué vista está abierta, filtros, ticket abierto, ventana emergente.
- `snap` = la **última copia conocida del servidor**, para saber qué cambió.

**Ciclo de cualquier acción** (por ejemplo, cambiar el estado de un ticket):
1. Un clic dispara un manejador de eventos (sección «Eventos» del archivo): busca el atributo `data-act="status"` del botón y llama a la función del mismo nombre
   en el objeto `A` (sección «Acciones»).
2. La acción **modifica `S` en memoria** (por ejemplo `setStatus()` cambia `t.status` y agrega una línea al historial con `log()`).
3. Llama a `save()`, que pone en cola `pushChanges()` (una cola ordenada: `syncQ`). La pantalla ya se actualizó: el usuario no espera al servidor.
4. `pushChanges()` compara cada ticket con `snap` y manda **solo lo que cambió**: el ticket (fila completa) si cambió, las líneas **nuevas** de historial,
   los comentarios **nuevos**, las aprobaciones nuevas y el registro de seguridad nuevo.
5. **Si el servidor rechaza algo** (un permiso, una regla): aparece el aviso «No se pudo guardar en el servidor: …» y la app **vuelve a leer todo del servidor**,
   deshaciendo en pantalla lo que no se aceptó.
6. `render()` redibuja `#app` entero a partir de `S` y `ui`.

**Sincronización entre personas:** cada **45 segundos** `refresh()` vuelve a leer el servidor (salvo que estés guardando, escribiendo, con una ventana
abierta o con la pestaña oculta). No hay tiempo real: otra persona ve tus cambios al recargar o dentro de ese lapso.

**Al guardar un ticket vinculado a Monday**, `queueMonday()` espera 2 s (para juntar cambios seguidos) y llama a la función `monday-sync` en segundo plano.

---

## 5. `js/novadesk.js` sección por sección

El archivo está dividido por comentarios con la forma `/* ───── Nombre ───── */`. En orden:

| Sección | Qué contiene |
|---|---|
| **Catálogos** | Constantes del negocio: `TYPES` (R/I/C), `PRIO` (Crítica…Baja), `SLA_H` (horas de SLA por prioridad), `FLOW` (estados de cada tipo), `CATS` (categorías), `ROLES`, `OPEN_NOT` (estados que cuentan como cerrados). |
| **Estado y persistencia** | `S`, `ui`, ayudantes (`me()`, `role()`, `staff()`, `client()`, `user()`). `staff()` = administrador **o** analista. |
| **Supabase: datos, sesión y sincronización** | El cliente `sb`, las funciones que traducen entre la base y la app (`ticketRow`/`fromTicket`, `userRow`/`fromUser`, `clientRow`/`fromClient`), `fetchAll`/`fetchData`/`applyData`, `pushChanges`, `save`, `refresh`, `enter`, `boot`. **Es la «capa de datos».** |
| **Seguridad: contraseñas y sesión** | `pwProblems()` (regla de contraseña: 10+ caracteres, mayúscula, minúscula, número y símbolo), `audit()` (registro de seguridad), cierre de sesión por inactividad (`IDLE`, 15 min), tema claro/oscuro. |
| **Nova: motor de clasificación** | Listas de palabras con pesos y la función `classify()`. Ver [sección 6](#6-nova-cómo-clasifica-un-ticket). |
| **SLA, riesgo y transiciones** | `slaInfo()` (vencimiento y semáforo), `risk()` (riesgo de un cambio), **`transitions()`** (qué botones de estado ve cada rol), `setStatus()` (aplica un cambio de estado con sus validaciones), `changeConflicts()` (choques de ventanas de cambio). |
| **Adjuntos** | Validación de archivos antes de subir (tipo y 10 MB), `attach()` (primero registra la ficha y después sube el archivo), `openFile()` (URL firmada de 1 minuto), `dropFile()` (primero borra el archivo y después la ficha), `viewFiles()`. |
| **Monday** | `parseMondayUrl()`, `mondayLink/Create/Unlink/Sync`, `queueMonday()`, `mondayProbe()` (pregunta si la función está lista), `viewMonday()` (tarjeta del ticket), `mondayCheck()` y `viewMondayAdmin()` (revisión de conexión, solo administrador). |
| **Utilidades de vista** | `visible()` (los tickets que **este usuario** debe ver), formato de fechas, avisos (`toast`), insignias. |
| **Vistas** | Una función por pantalla: `viewLogin`, `viewForceChange` (cambio obligatorio de clave temporal), `viewShell` (menú lateral), `viewDashboard`, `viewTickets`, `viewBoard` (tablero kanban), `viewChanges` (CAB y calendario), `viewClients`, `viewClient` (las personas de un cliente), `viewUsers`, `viewNew` (ticket nuevo), `viewDrawer` (ticket abierto), `viewOverlay` (ventanas emergentes). Cada una **devuelve texto HTML**. |
| **Render y router** | `render()` elige la vista según `ui.view`, la pinta, y además `nlSearch()` / `paletteResults()` (la búsqueda en lenguaje natural con Ctrl + K). |
| **Acciones** | El objeto `A` (una función por botón), `SUBMIT` (formularios), `login()`, `createTicket()`, `callFn()` (llama a una Edge Function), `setOwnPassword()`. |
| **Eventos** | Los «oídos» de la página: clics, escritura, cambios, envío de formularios, atajos de teclado, arrastrar y soltar (archivos y tarjetas del tablero), pegar capturas. Al final, `boot()`. |

Dos listas importantes al final de «Eventos»:
- `ADMIN_ACTS`: acciones que **solo el administrador** puede disparar (clientes, usuarios, revisión de Monday).
- `STAFF_ACTS`: acciones de **analista o administrador** (aprobar cambios, exportar CSV, aplicar sugerencias de Nova, vincular con Monday).

> Importante: estas listas y `transitions()` **esconden botones**, pero no son la protección real. Un usuario con conocimientos podría saltarse la pantalla;
> por eso la base repite las mismas reglas (ver sección 9).

### Flujo de estados

- **Requerimiento / Incidente:** `Nuevo → Asignado → En curso ⇄ En espera → Resuelto → Cerrado` (y reabrir: `Resuelto/Cerrado → En curso`).
  Analista/administrador **asignan** (`Nuevo → Asignado`); el técnico **toma** el ticket (`Nuevo → En curso`).
- **Cambio (C):** `Borrador → En evaluación → Aprobado / Rechazado → Programado → Implementando → Implementado → Cerrado`. Aprobar, programar y cerrar son de
  analista/administrador. Para pasar a «En evaluación» se exige plan de **rollback**; para «Programado», una **ventana** definida.

La misma tabla de transiciones está duplicada en el trigger `tickets_guard` de la base (`docs/migracion-03-permisos.sql`). **Si cambias una, cambia la otra.**

---

## 6. Nova: cómo clasifica un ticket

**No es inteligencia artificial externa**: son reglas de lenguaje (español de Chile) que corren en el navegador. `classify(texto, cliente, opciones)` devuelve:
tipo, categoría, prioridad, impacto, técnico sugerido, tickets similares, posible incidente mayor, acciones sugeridas, confianza y el «porqué».

Cómo decide, en orden:
1. **Normaliza** el texto (`norm`: minúsculas y sin tildes).
2. **Tipo.** Suma puntos por tipo con las listas `TYPE_KW` (I, R, C). Cada palabra pesa: normal = 1, frase = 1.6, `+palabra` = fuerte (2), `~palabra` = débil (0.4).
   `raiz*` acepta cualquier terminación; `no X` también calza «no me X», «no se X»; `(a|b)` son alternativas. Si empatan gana el incidente.
   «Cambio» exige al menos 1 punto (palabras sueltas como «actualizar» no bastan para llamarlo Control de cambios; `COTIDIANO` evita confundir «cambio de clave» con un cambio).
   Si la persona eligió el tipo, se respeta.
3. **Categoría.** Igual con `CAT_KW`. Si ninguna llega a 0.4 puntos → `General`. «Seguridad» va primero para ganar los empates.
4. **Prioridad (1 a 4).** Parte de 3 (los requerimientos, de 3.4), **baja** con señales de criticidad/masivo (`CRIT`, `MASS`) y de impacto (`HIGH`), y **sube** con señales
   de baja urgencia (`LOW`, y frases tranquilas `CALM` como «no es urgente»). Reglas fijas: incidente masivo ≤ 1.4; un cambio nunca baja de 2; «emergencia» fuerza 1.
5. **Técnico sugerido.** Entre los técnicos activos (o, si no hay, los usuarios activos): +3 si domina la categoría, −0.6 por cada ticket abierto que ya tiene.
6. **Similares.** Compara las palabras (sin muletillas ni plurales) con los demás tickets.
7. **Incidente mayor.** 2 o más incidentes abiertos de la misma categoría y cliente en 24 h (la categoría General no cuenta).
8. **Acciones.** Una lista por categoría (`PLAYBOOK`), más un aviso extra para prioridad 1 y para cambios.
9. **Confianza** = promedio de la certeza de tipo y de categoría.

**Dónde se usa:** el formulario de ticket nuevo (propone mientras escribes y rellena lo que dejaste «Automático»), `createTicket()` (asigna sola si la prioridad es 1–2 y
quien crea es analista/administrador), `setStatus()` (si falta técnico al pasar a Asignado/En curso), los botones «aplicar sugerencia»/«asignar con Nova»,
la búsqueda Ctrl + K (`nlSearch`) y los avisos del panel (`insights`).

**Para ajustarla:** edita las listas (`TYPE_KW`, `CAT_KW`, `CRIT`, `HIGH`, `LOW`, `MASS`, `CALM`, `PLAYBOOK`). Es la parte más fácil de modificar sin riesgo de romper otras:
solo cambia sugerencias. Nova está pensada para poder reemplazarse por una llamada a un modelo de lenguaje: bastaría con que `classify()` devolviera la misma forma.

---

## 7. La base de datos

PostgreSQL dentro de Supabase. Se arma ejecutando, **en este orden**, en el *SQL Editor*: `schema.sql`, `migracion-02-app.sql`, `migracion-03-permisos.sql`,
`migracion-04-adjuntos.sql`, `migracion-05-monday.sql`, `migracion-06-contactos.sql`; y después `pruebas-permisos.sql` (todo debe salir ✔).

### Tablas

| Tabla | Qué guarda |
|---|---|
| `clients` | Clientes: nombre, código, color, contacto y **`sla_factor`** (0.75 = SLA 25 % más exigente). |
| `profiles` | Un perfil por usuario: usuario, nombre, **rol**, activo, habilidades, `must_change` (clave temporal). La contraseña **no** está aquí: vive en Supabase Auth (`auth.users`). |
| `ticket_counters` | Contador por tipo (R/I/C) para numerar. Solo la función `next_ticket_id()` la toca. |
| `tickets` | El ticket: tipo, asunto, descripción, cliente, prioridad, estado, categoría, asignado, creado por, fechas, y los campos del cambio (`change_*`). |
| `ticket_comments` | Comentarios (con marca de «nota interna»). |
| `ticket_history` | Historial de acciones y cambios de estado (base para medir tiempos). |
| `change_approvals` | Aprobaciones o rechazos del CAB. |
| `audit_log` | Registro de seguridad (inicios de sesión, contraseñas, usuarios). Solo el administrador lo lee. |
| `ticket_attachments` | La «ficha» de cada archivo (nombre, tipo, tamaño, quién lo subió, ruta). |
| `ticket_links` | El ítem de Monday vinculado a un ticket (máximo uno por ticket). |
| `client_contacts` | Las **personas de cada cliente** (nombre, cargo o área, correo, teléfono, activa). El ticket apunta a una con `tickets.contact_id` (la base exige que sea del mismo cliente del ticket) y además guarda su nombre en `tickets.requester`, que sigue siendo el texto que leen Power BI y los tickets antiguos. |
| *Storage* `ticket-files` | El bucket **privado** donde están los archivos de verdad. |

### Funciones y disparadores (triggers) importantes

| Nombre | Para qué |
|---|---|
| `app_role()` | Devuelve el rol de quien llama **si está activo** (si no, nada). Casi todas las reglas se apoyan en ella. |
| `can_see_ticket(id)` | ¿Puede ver este ticket? Analista/administrador: todos. Técnico: los asignados a él o creados por él. Inactivo: ninguno. |
| `next_ticket_id(tipo)` | Entrega el siguiente número (`I-0001`) sin repetirse aunque varias personas creen tickets a la vez. |
| `handle_new_user` (trigger en `auth.users`) | Al crear un usuario en Auth, crea su perfil **inactivo y sin privilegios**; un administrador lo activa. |
| `touch_login()`, `clear_must_change()` | Acciones que cada usuario hace sobre su propio perfil (último acceso, clave temporal ya cambiada). |
| `tickets_guard` (trigger) | **El guardián.** Al modificar un ticket decide quién puede cambiar qué y qué cambios de estado son válidos (calca `transitions()`). |
| `tickets_before_insert`, `stamp_created_at` (triggers) | Las **fechas las pone el servidor**, no el navegador. |

### Seguridad por fila (RLS)

Todas las tablas tienen **RLS** (*Row Level Security*): la base filtra cada consulta según quién la hace. Resumen:
- Analista/administrador ven todos los tickets; el técnico solo los suyos (`can_see_ticket`).
- Un usuario **inactivo** no ve nada.
- Solo el administrador gestiona clientes y usuarios y lee el registro de seguridad.
- Adjuntos: los ve quien ve el ticket; los borra quien los subió, un analista o el administrador.
- Vínculo con Monday: lo ven quienes ven el ticket; solo analista/administrador lo crean o quitan.
- Personas de los clientes: las ve todo usuario activo (las necesita para crear tickets); solo analista/administrador las agregan o editan; nadie las borra (se desactivan).
  El técnico elige la persona al crear el ticket pero no la cambia después (`tickets_guard`).
- El técnico no cambia prioridad, categoría, asunto ni reasigna (solo puede tomar un ticket sin asignar).

### Para Power BI

`schema.sql` crea un esquema aparte `bi` con vistas de solo lectura (`bi.tickets`, `bi.ticket_estado_historial`, `bi.comentarios`) y un rol `powerbi_reader`.
Ojo: la vista `bi.tickets` repite los valores de SLA (4/8/24/72 h × `sla_factor`): si cambias `SLA_H` en `js/novadesk.js`, cambia también la vista.
**Revisa el aviso de la [sección 13](#13-límites-conocidos-y-cosas-por-revisar) sobre la clave de `powerbi_reader`.**

### Cómo cambiar la base sin romper nada

Nunca edites `schema.sql` ya aplicado. Crea `docs/migracion-06-….sql` (siguiente número), escrita para poder ejecutarse más de una vez
(`create … if not exists`, `drop … if exists` antes de `create`), con su bloque «Deshacer» comentado al final y pruebas nuevas en `pruebas-permisos.sql`.
Se aplica primero en el Supabase de **QA**, se ejecutan las pruebas, y solo entonces en Producción (ver [entornos.md](entornos.md)).

---

## 8. Las funciones del servidor (Edge Functions)

Son programas pequeños (TypeScript, entorno Deno) que corren **en Supabase** y pueden usar la **clave secreta** del proyecto, que jamás llega al navegador.
La página las llama con `callFn(nombre, datos)`. Las dos validan primero **quién llama** (revisan el token de sesión y el rol en `profiles`).

### `admin-users`
Solo **administrador**. Dos acciones:
- `create`: crea el usuario en Auth (correo confirmado, clave temporal aleatoria de 14 caracteres), actualiza su perfil (rol, habilidades, activo) y lo anota en el registro de seguridad.
  Si falla el perfil, borra el usuario recién creado. Devuelve la clave temporal **una sola vez**.
- `reset`: genera otra clave temporal y marca `must_change`.

### `monday-sync`
Mantiene el ítem de Monday de un ticket. Acciones: `status` (¿está configurado?), `create` (analista/administrador), `sync` (quien ve el ticket), `columns` (solo administrador: compara
lo configurado con las columnas reales del tablero). Lee del servidor el ticket, el cliente y el técnico y arma los valores (`buildValues`). Solo va de NovaDesk a Monday.
**No manda la descripción del ticket** (puede traer datos sensibles); sí el asunto como nombre del ítem.
Se configura con secretos (no con código): `MONDAY_TOKEN`, `MONDAY_BOARD_ID`, `MONDAY_COLUMNS` (JSON que dice a qué columna va cada dato), y opcionales
`MONDAY_GROUP_ID`, `MONDAY_APP_URL`, `MONDAY_API_VERSION`. Detalle y pasos en [integracion-monday.md](integracion-monday.md).

Dato práctico: ambas usan `secretKey()` para obtener la clave secreta tanto en proyectos nuevos de Supabase como en antiguos. En proyectos nuevos hay que dejar **desactivada**
la opción «Verify JWT with legacy secret» de cada función (la función ya valida el token por su cuenta); si está activa, rechaza las sesiones de la app.

---

## 9. Seguridad: dónde se aplica cada regla

La regla de oro: **lo que importa se aplica en la base, no en la pantalla**. La pantalla solo esconde botones para no confundir.

| Tema | Pantalla (`js/novadesk.js`) | Servidor (lo que de verdad protege) |
|---|---|---|
| Quién ve qué tickets | `visible()` | RLS + `can_see_ticket()` |
| Quién cambia prioridad, categoría, reasigna | `transitions()`, `STAFF_ACTS`, listas desplegables | Trigger `tickets_guard` |
| Flujo de estados | `transitions()` | Trigger `tickets_guard` |
| Fechas (creación, resolución…) | se calculan también aquí, pero se ignoran | Triggers (`now()` del servidor) |
| Crear usuarios / restablecer claves | `ADMIN_ACTS` | `admin-users` (exige rol admin) |
| Contraseñas | `pwProblems()` (10+, mayúscula, minúscula, número, símbolo) | Supabase Auth guarda el hash. **Las reglas finas solo las exige la pantalla**; la política del servidor se configura en Supabase |
| Sesión | cierre a los 15 min sin actividad (`IDLE`), sesión en `sessionStorage` | tokens de Supabase Auth |
| Archivos | validación previa (tipo, 10 MB) | bucket privado, tipos permitidos, políticas de Storage, URL firmada de 1 min |
| Token de Monday | nunca está en la página | secreto de Supabase, solo lo lee `monday-sync` |

**Qué es público y qué no:**
- Público (va en `js/config.js`, está bien): la URL del proyecto y la clave **publishable** (antes «anon»). Solo sirve dentro de lo que RLS permite.
- **Nunca** en el código ni en el repositorio: la clave **secret** / `service_role`, el token de Monday, la contraseña de `powerbi_reader` y las contraseñas reales.
- El repositorio de QA es **público** (GitHub Pages gratuito): no pongas datos reales ahí.

---

## 10. Entornos y publicación

Resumen (el detalle y el paso a paso están en [entornos.md](entornos.md)):

| | DEV | QA | Producción |
|---|---|---|---|
| Dónde | tu carpeta, `http://localhost:8123` | página `…/NovaDesk-QA/` | página `…/NovaDesk-Prod/` |
| Base de datos | **simulada** en el navegador (`dev/backend.js`) | Supabase de QA | Supabase de Producción |
| Monday | simulado | tablero de **ensayo** | tablero definitivo |

- El **mismo código** corre en los tres: `js/config.js` mira la dirección (`SITIOS`: dominio + primera carpeta de la ruta) y elige. DEV usa una URL falsa **a propósito** (`dev-simulado.supabase.co`)
  para que jamás pueda tocar una base real.
- **DEV no replica los permisos de la base** (RLS ni triggers): por eso los permisos se prueban en QA con `pruebas-permisos.sql`.
- `scripts/flujo.ps1` (se usa vía `.\scripts\flujo.cmd`): `estado`, `configurar`, `qa` (sube a QA), `produccion` (sube a Producción solo lo que ya está en QA y pregunta si lo probaste).
  El archivo `scripts/pre-push` es un candado de git que bloquea subir a Producción algo que no esté en QA. **Vive en tu computador**: no protege contra alguien que suba desde otro lugar.
- Orden con cambios de base o de funciones: aplicarlos primero en QA, probar, y en Producción **antes** de `flujo produccion`.

---

## 11. Recetas: «quiero cambiar X, ¿qué toco?»

Después de **cualquier** cambio: probarlo en DEV → subir a QA → probar ahí → recién entonces Producción. Si tocaste reglas de la base, ejecuta `pruebas-permisos.sql` en QA.

| Quiero… | Toco… |
|---|---|
| **Agregar un cliente** | Nada de código: pantalla *Clientes* → «Nuevo cliente» (solo administrador). |
| **Agregar las personas de un cliente** | Nada de código: *Clientes* → «👥 Personas» → «＋ Nueva persona» (analista o administrador). Al crear un ticket aparecen como solicitante. Código: `viewClient()`, `requesterField()`, `requesterCell()`, `SUBMIT.savePerson`. |
| **Cambiar los tiempos de SLA** | `SLA_H` en `js/novadesk.js` (+ la vista `bi.tickets` si usas Power BI). El factor por cliente se cambia en la pantalla *Clientes*. |
| **Agregar una categoría** | `CATS`, `CAT_KW` y `PLAYBOOK` en `js/novadesk.js`. No requiere SQL (la categoría es texto libre en la base). Las habilidades de los técnicos usan estos mismos nombres. |
| **Ajustar cómo Nova clasifica** | `TYPE_KW`, `CAT_KW`, `CRIT`, `HIGH`, `LOW`, `MASS`, `CALM`, `PLAYBOOK` (sección 6). |
| **Cambiar el tiempo de cierre por inactividad** | `IDLE` en `js/novadesk.js` (hoy 15 min). |
| **Cambiar la política de contraseñas** | `pwProblems()` en `js/novadesk.js` **y** la configuración de Authentication en Supabase (para que el servidor también la exija). La clave temporal la genera `tempPassword()` en `admin-users`. |
| **Agregar o cambiar un estado del flujo** | `FLOW`, `transitions()`, `setStatus()` y `OPEN_NOT` en `js/novadesk.js` **y** el trigger `tickets_guard` (migración nueva) **y** `pruebas-permisos.sql`. Si el estado cuenta como cerrado, `resolved_at` también. |
| **Agregar un campo al ticket** | Columna nueva en `tickets` (migración) → `ticketRow()` y `fromTicket()` → `viewNew()`/`createTicket()` (crear) → `viewDrawer()` (mostrar/editar) → `tickets_guard` si el técnico no debe editarlo → vista `bi.tickets` si va a Power BI. Como `pushChanges()` compara `ticketRow()`, un campo agregado ahí se guarda solo. |
| **Mandar otro dato a Monday** | `FIELDS` y `buildValues()` en `monday-sync`; `MONDAY_CAMPOS` y `mondaySig()` en `js/novadesk.js` (qué cambios disparan la actualización); y `MONDAY_COLUMNS` + la columna en el tablero. |
| **Cambiar a qué tablero / token de Monday** | Solo secretos en Supabase (no código). Ver [integracion-monday.md](integracion-monday.md). |
| **Cambiar la dirección pública de la página** | `SITIOS` en `js/config.js` y `MONDAY_APP_URL`. Los enlaces ya guardados en Monday seguirán apuntando a la dirección vieja. |
| **Agregar un rol nuevo** | Es un cambio grande: `ROLES`, `role in (…)` de `profiles` (migración), `app_role()`, las políticas y `tickets_guard`, `admin-users`, la matriz de permisos y las pruebas. Planificarlo como proyecto. |
| **Agregar una pantalla** | Una función `viewXxx()`, registrarla en `views` (dentro de `render()`) y en el menú `NAV`. |
| **Cambiar colores o tema** | Variables al inicio de `css/novadesk.css`. |

---

## 12. Cuando algo falla

| Lo que ves | Causa probable | Dónde mirar |
|---|---|---|
| «Usuario o contraseña incorrectos» | Usuario mal escrito, o ese usuario no existe en Auth con ese correo. Recuerda: `usuario` = `usuario@novadesk.local`; si se creó con otro correo, hay que escribirlo completo. | Supabase → Authentication → Users |
| «Tu cuenta está inactiva» | El perfil nace inactivo (`handle_new_user`); un administrador debe activarlo. | Tabla `profiles` (`active`) o pantalla *Usuarios* |
| «No se pudo guardar en el servidor: …» | La base rechazó el cambio (un permiso o una regla del flujo; el mensaje suele estar en español) o no hubo conexión. La app vuelve a leer del servidor. | Mensaje exacto; `tickets_guard` en la migración 03 |
| La página dice que la dirección no está registrada o no se conecta | La dirección no está en `SITIOS` de `js/config.js`. | `js/config.js` |
| Franja «falta configurar su Supabase» | Quedó `PENDIENTE` en la URL/clave del entorno. | `js/config.js` |
| Las funciones responden «Sesión inválida» | En proyectos nuevos de Supabase, está activa «Verify JWT with legacy secret» en la función. | Supabase → Edge Functions → la función → ajustes |
| Crear/restablecer usuario falla | Función `admin-users` no desplegada, o el que llama no es administrador activo. | Supabase → Edge Functions → Logs |
| Monday: «rechazó el token» / «no encontró el tablero» | `MONDAY_TOKEN` vencido o sin acceso al tablero; `MONDAY_BOARD_ID` mal. | Pantalla *Usuarios* → «Revisar conexión»; secretos de Supabase |
| Monday: una columna sale ❌ o ⚠️ | El ID o el tipo en `MONDAY_COLUMNS` no coincide con el tablero (en Monday, cambiar el tipo de una columna crea otra con ID nuevo). | «Revisar conexión» → «Columnas del tablero» |
| Un adjunto no sube | Tipo no permitido, más de 10 MB, o sin permiso sobre el ticket. | Aviso en pantalla; migración 04 |
| Los datos de DEV están raros | Son datos de ejemplo guardados en tu navegador. | Panel «🧪 DEV» → «Restablecer datos de DEV» |
| Todo deja de funcionar de golpe en el plan gratuito | El proyecto de Supabase gratuito puede **pausarse por inactividad**. Verifica las condiciones vigentes del plan. | Panel de Supabase |

---

## 13. Límites conocidos y cosas por revisar

**Por revisar (seguridad):**
- **La clave del rol `powerbi_reader`.** Las versiones anteriores de `docs/schema.sql` crearon ese rol con la contraseña de relleno `CAMBIAR-POR-CLAVE-LARGA`, que **quedó escrita en el repositorio
  (y sigue en su historial de git aunque el archivo ya se corrigió)** (el repositorio de QA es público y el de Producción probablemente también, porque GitHub Pages gratuito lo exige: compruébalo en GitHub → Settings). Si ese archivo se ejecutó tal cual en un proyecto de Supabase y nadie cambió la clave, cualquiera que conozca
  la dirección de la base podría conectarse con ese rol y **leer las vistas `bi.*`** (asuntos de tickets, clientes, solicitantes, técnicos), saltándose RLS.
  Qué hacer en **cada** proyecto de Supabase (QA y Producción), desde el *SQL Editor*:
  ```sql
  select rolname, rolcanlogin from pg_roles where rolname = 'powerbi_reader';   -- ¿existe?
  alter role powerbi_reader with login password '<una clave larga y única, guardada en un gestor de contraseñas>';
  -- o, si no vas a usar Power BI todavía:
  -- alter role powerbi_reader nologin;
  ```
  Como la clave vieja seguirá visible en el historial del repositorio, lo que protege es **cambiarla (o quitar el acceso) en la base**, no solo editar el archivo.
  `docs/schema.sql` ya está corregido: en instalaciones nuevas crea el rol sin acceso (`nologin`) y sin contraseña; para usar Power BI se habilita aparte con el `alter role … with login password …` de arriba.
- Las **reglas finas de contraseña** (mayúscula, símbolo, etc.) las exige la pantalla; el servidor solo exige lo que se configure en Supabase Auth.
- Los candados de publicación (`pre-push`) viven en un computador, no en GitHub.

**Límites del diseño (no son errores, pero hay que saberlos):**
- **Si dos personas editan el mismo ticket a la vez**, gana el último en guardar: `pushChanges()` manda la fila completa del ticket, así que puede pisar un cambio de otra persona hecho entre medio.
  Con pocos usuarios rara vez se nota; con muchos habría que enviar solo los campos modificados o usar control de versiones por fila.
- No hay **tiempo real**: los cambios de otros aparecen al recargar o cada ~45 s.
- Todo el código de pantalla está en **un solo archivo** y no hay pruebas automáticas del front-end; solo las pruebas SQL de permisos. Para equipos más grandes conviene dividirlo y agregar pruebas.
- Las fechas de Monday usan la zona horaria `America/Santiago` (fija en `monday-sync`) y la pantalla usa `es-CL`.
- El registro de seguridad en pantalla guarda en memoria los últimos 200 eventos (en la base no hay límite).
- El plan gratuito de Supabase tiene límites (espacio, pausa por inactividad, sin respaldos automáticos). Para datos reales de clientes, hablar con TI sobre respaldos y protección de datos
  (el diseño inicial menciona la Ley 21.719). Ver [alojamiento-otro-servidor.md](alojamiento-otro-servidor.md).
- `docs/plan-base-de-datos.md` describe el diseño inicial y algunas partes ya cambiaron (por ejemplo, ya no se usa `localStorage`).

---

## 14. Glosario

- **Supabase:** servicio que ofrece, juntos, base de datos PostgreSQL, login, almacenamiento de archivos y funciones de servidor.
- **PostgreSQL:** el motor de base de datos.
- **RLS (Row Level Security):** reglas dentro de la base que filtran qué **filas** puede leer o modificar cada usuario.
- **Trigger (disparador):** código de la base que se ejecuta solo al insertar o modificar una fila (aquí valida permisos y pone fechas).
- **Migración:** un archivo `.sql` que cambia la base de un estado al siguiente. Se numera y se ejecuta en orden.
- **Edge Function:** programa que corre en el servidor de Supabase; permite usar claves secretas sin exponerlas al navegador.
- **Clave publishable (antes «anon»):** clave pública que identifica el proyecto; sola no da acceso a nada que RLS no permita.
- **Clave secret (antes «service_role»):** clave maestra: salta todas las reglas. **Nunca** va en la página ni en el repositorio.
- **JWT / token de sesión:** «credencial» temporal que el navegador recibe al iniciar sesión y envía en cada petición.
- **SLA:** tiempo comprometido de resolución. Aquí: horas por prioridad × factor del cliente.
- **CAB:** comité que aprueba los cambios (Control de cambios).
- **Rollback:** plan para deshacer un cambio si sale mal.
- **DEV / QA / Producción:** desarrollo (tu carpeta), pruebas (página aparte con su propia base) y uso real.
- **CDN:** servidor público que entrega una librería (aquí, jsDelivr entrega `supabase-js`).
- **CORS:** regla del navegador que decide qué sitios pueden llamar a un servidor; por eso Monday no se llama desde el navegador sino desde una función del servidor.
