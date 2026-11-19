# NovaDesk

Mesa de ayuda con Requerimientos (R), Incidentes (I) y Control de cambios (C).

- Front-end estático (HTML/CSS/JS, sin build). Los datos y el login viven en **Supabase** (PostgreSQL + Auth, plan gratuito).
- Para trabajar en local sirve la carpeta con cualquier servidor estático (`.claude/serve.ps1` levanta uno en el puerto 8123). Se publica con GitHub Pages.
- Configuración: `js/config.js` (URL del proyecto y clave *publishable* de cada entorno; son públicas por diseño). Nunca pongas ahí la clave *secret*.
- Base de datos: `docs/schema.sql`, luego `docs/migracion-02-app.sql`, `docs/migracion-03-permisos.sql`, `docs/migracion-04-adjuntos.sql` y `docs/migracion-05-monday.sql`. Detalle y plan de Power BI en `docs/plan-base-de-datos.md`.
- **Entornos — el flujo es siempre DEV → QA → Producción** (guía completa en `docs/entornos.md`):
  - **DEV** es esta carpeta (http://localhost:8123): aquí se hacen los cambios. **No usa Supabase**: al abrir la página desde `localhost`, `index.html` carga
    `dev/backend.js`, que simula Auth, tablas, archivos y las Edge Functions (`admin-users`, `monday-sync`) con datos de ejemplo guardados en el navegador
    (panel «🧪 DEV» abajo a la izquierda; Monday simulado en `dev/monday.html`). No gasta cuota de nadie y no replica los permisos de la base (RLS).
  - **QA** es una página publicada aparte (repositorio `NovaDesk-QA`) conectada a **su propio Supabase**: aquí se prueba con una base real (permisos, funciones, Monday con tablero de ensayo).
  - **Producción** es el repositorio `NovaDesk` (GitHub Pages) con el Supabase real.
  - Se pasa de uno al siguiente con `.\scripts\flujo.cmd qa` y `.\scripts\flujo.cmd produccion`; un candado de git impide publicar en Producción algo que no esté ya en QA.
    El mismo código corre en los tres: `js/config.js` elige la configuración según la dirección donde está publicado.
- **Monday:** cada ticket se puede vincular a un ítem de Monday (pegando su enlace o creándolo desde NovaDesk en un tablero único «Mesa de ayuda»), en un solo sentido
  NovaDesk → Monday. El token vive solo en la Edge Function `monday-sync`. Guía de configuración y de paso por los entornos en `docs/integracion-monday.md`.
- **Adjuntos:** cada ticket acepta archivos (capturas, PDF, Office, texto, CSV, ZIP, correos .eml/.msg; máx. 10 MB c/u) que se suben con el botón,
  arrastrándolos o pegando una captura con Ctrl+V, también al crear el ticket. Viven en un bucket **privado** de Supabase Storage y se abren con una URL
  firmada de un minuto. Los ve quien ve el ticket; los borra quien los subió, un analista o el administrador. El plan gratuito de Supabase da 1 GB en total.
- Roles: Administrador, Analista, Técnico. Los permisos de cada rol los aplica la **base** (RLS + disparadores), no solo la pantalla:
  el técnico solo ve lo asignado a él o creado por él, mueve el estado dentro de su flujo y no cambia prioridad, categoría ni reasigna;
  aprobar, programar y cerrar es de analista/administrador; un usuario inactivo no ve nada; las fechas las pone el servidor.
  Vincular tickets con Monday es de analista/administrador. `docs/pruebas-permisos.sql` verifica todo esto con usuarios falsos (no deja nada guardado): ejecutarlo después de cualquier cambio en las reglas.
- Clientes iniciales: Bupa, Curico, HAH. El administrador agrega más desde Clientes.
- **Usuarios:** el administrador los crea desde la pantalla Usuarios (＋ Nuevo usuario): elige nombre, usuario o correo, rol y habilidades,
  y la app le muestra una contraseña temporal una sola vez. También puede restablecer claves. Lo hace la Edge Function `admin-users`
  (`supabase/functions/admin-users/index.ts`), que usa la clave secreta en el servidor y exige que quien llama sea administrador.
  La primera vez que ingresa, la persona debe cambiar la clave temporal. Se ingresa con el usuario o con el correo completo.
- El primer administrador se crea a mano en Supabase (Authentication → Users) y se promueve con
  `update public.profiles set role='admin', active=true where username='...';`
- Seguridad: las contraseñas las guarda Supabase Auth (nunca la app), política de 10+ caracteres con mayúscula, minúscula, número y símbolo,
  cierre de sesión a los 15 min de inactividad, registro de seguridad, permisos por rol y RLS en todas las tablas.
- **Nova** (`classify()` en `js/novadesk.js`): clasifica tipo, categoría, prioridad, impacto y técnico sugerido
  con reglas de lenguaje y habilidades/carga; detecta incidentes mayores y tickets similares.
  Es un motor local sin API externa; puede reemplazarse por una llamada a un modelo de lenguaje.
- Los cambios de otros usuarios se ven al recargar o dentro de ~45 s (la app relee la base sola).

Pendiente: Edge Function para crear usuarios/restablecer claves desde la app, notificaciones por correo, bloqueo por intentos fallidos propio.
