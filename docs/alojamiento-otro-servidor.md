# Llevar NovaDesk a otro servidor o a otra base de datos

Hoy NovaDesk corre así: **páginas en GitHub Pages** + **base de datos, login, archivos y funciones en Supabase** (plan gratuito). Si la empresa lo aprueba,
es normal que TI pida alojarlo en su propia infraestructura. Este documento dice **qué depende de qué, qué caminos hay, qué cambiaría en el código y en qué orden se hace**.

**Respuesta corta:** sí se puede. Hay tres caminos, de menor a mayor esfuerzo. Los dos primeros **no reescriben nada** (solo cambian dónde vive Supabase);
el tercero (otra base de datos o un servidor propio sin Supabase) es un proyecto de desarrollo.

> Lo que dice este documento sobre Supabase autoalojado y sobre migrar datos viene de su documentación oficial y de guías de terceros
> ([Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker), [Restore a Platform Project to Self-Hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)).
> Los requisitos y límites **cambian con las versiones**: confírmalos en esas páginas antes de decidir.

---

## 1. De qué depende hoy NovaDesk

| Pieza | Hoy | Dónde está en el código | ¿Se puede cambiar? |
|---|---|---|---|
| Páginas (HTML/CSS/JS) | GitHub Pages | `index.html`, `css/`, `js/` | **Sí, fácil.** Son archivos estáticos: sirven IIS, nginx, Apache, Netlify, Cloudflare Pages, etc. |
| Librería `supabase-js` | CDN jsDelivr | una etiqueta `<script>` en `index.html` (versión fija, con huella de integridad) | Sí: se descarga y se sirve desde tu propio servidor (necesario si la red no tiene salida a internet). Es la **única** dependencia externa del navegador. |
| Base de datos | PostgreSQL de Supabase | `docs/schema.sql` y migraciones | Tiene que ser **PostgreSQL**: el SQL usa RLS, disparadores en plpgsql, arreglos (`text[]`), `uuid`, `timestamptz`. En SQL Server, MySQL u Oracle habría que reescribir todo. |
| Login | Supabase Auth | ≈9 llamadas `sb.auth.*` en `js/novadesk.js`; correo interno `usuario@novadesk.local` | Sí con Supabase propio. Con otro sistema (p. ej. Active Directory/SSO) hay que reescribir esa parte. |
| API de datos | PostgREST (viene con Supabase) | ≈16 llamadas `sb.from(...)` y 3 `sb.rpc(...)` | Idem. |
| Archivos adjuntos | Supabase Storage | 3 llamadas `sb.storage` + `docs/migracion-04-adjuntos.sql` | Idem. |
| Funciones del servidor | Edge Functions (Deno/TypeScript) | `supabase/functions/admin-users`, `monday-sync` | Se pueden copiar a un Supabase propio o reescribir en otro lenguaje (Node, .NET…). |
| Monday | API de Monday, llamada solo desde `monday-sync` | `monday-sync` | No depende del alojamiento; necesita **salida a internet desde el servidor** hacia `api.monday.com`. |
| Publicación | GitHub + `scripts/flujo.ps1` | `scripts/` | Hay que adaptarla al nuevo destino (ver sección 4). |

Casi todo el acceso a Supabase está **concentrado** en unas ≈30 llamadas, dentro de las secciones «Supabase», «Adjuntos», «Monday» y «Acciones» de `js/novadesk.js`
(ver la [guía del código](guia-del-codigo.md)). Eso es lo que hace posible el camino C, aunque costoso.

---

## 2. Los tres caminos

### A) Supabase en la nube, pero a nombre de la empresa (otro proyecto, plan o región)

- **Qué cambia:** solo `js/config.js` (URL y clave pública del proyecto nuevo, y la dirección de la página). **El código no se toca.**
- **Esfuerzo:** horas.
- **Ventajas:** nada que administrar; los planes de pago traen lo que el gratuito no (por ejemplo respaldos automáticos y que el proyecto no se pause por inactividad: **verifica las condiciones vigentes**).
- **A resolver con TI/legal:** si pueden alojar datos de clientes en un servicio de terceros, en qué país/región, y bajo qué contrato (el diseño inicial menciona la Ley 21.719).
- **Cuándo elegirlo:** si la empresa acepta un proveedor en la nube y solo quiere que la cuenta, el pago y el control sean suyos.

### B) Supabase propio (autoalojado) en un servidor de la empresa

- **Qué cambia:** el mismo código y el mismo SQL, contra un Supabase que corre en tu infraestructura. Supabase publica una configuración con **Docker Compose** para eso.
  Cambia `js/config.js` (URL y clave del servidor propio).
- **Esfuerzo:** días (preparar el servidor, HTTPS, claves, respaldos).
- **Qué hace falta:** un servidor Linux con Docker y Docker Compose; un dominio con certificado HTTPS; memoria suficiente (guías de terceros hablan de unos 4 GB como mínimo y 8 GB recomendados
  para producción: confírmalo); correo saliente (SMTP) si algún día se quieren notificaciones; y **respaldos propios**: el autoalojado no trae un sistema de respaldos listo
  (se respalda la base con `pg_dump` y la carpeta de archivos, además de la configuración `.env`).
- **Ojo:** la documentación oficial indica que el autoalojado tiene **soporte de la comunidad**; las actualizaciones y los parches son responsabilidad de quien lo administra.
- **Qué hay que hacer a mano:** copiar las Edge Functions a la carpeta de funciones del stack, cargar los secretos de Monday como variables de entorno, y revisar cómo se llama la clave
  secreta en esa instalación (la función `secretKey()` ya acepta la variante antigua y la nueva, pero conviene probarlo).
- **Cuándo elegirlo:** si TI exige que los datos queden dentro de la empresa pero acepta una herramienta ya hecha.

### C) Otra base de datos y/o un servidor propio, sin Supabase

- **Qué cambia:** hay que escribir un **backend** (Node, .NET, Java… lo que use TI) que reemplace lo que hoy hace Supabase: login, API con permisos, archivos y funciones.
  Las reglas que hoy están en la base (RLS y disparadores) pasarían al código del backend. En el navegador hay que reemplazar la capa de datos de `js/novadesk.js`
  y actualizar el simulador `dev/backend.js`. Si la base fuera otra que PostgreSQL, se reescribe todo el SQL.
- **Esfuerzo:** semanas, con pruebas de permisos nuevas (hoy `docs/pruebas-permisos.sql` las cubre para PostgreSQL).
- **Cuándo elegirlo:** solo si TI **exige** un estándar propio (otro motor de base de datos o un login corporativo) y no acepta Supabase en ninguna de sus formas.
  Antes de empezar conviene acordar con TI lenguaje, base de datos, forma de autenticación y quién mantendrá el backend.

### Comparación rápida

| | A) Supabase nube de la empresa | B) Supabase propio | C) Backend propio |
|---|---|---|---|
| Código a cambiar | solo `js/config.js` | solo `js/config.js` | capa de datos, funciones y SQL |
| Esfuerzo | horas | días | semanas |
| Quién administra | Supabase | tu equipo/TI | tu equipo/TI |
| Datos en casa | no | **sí** | **sí** |
| Riesgo técnico | bajo | medio (operación) | alto (reescritura) |

**Recomendación:** A si la empresa acepta un proveedor externo; B si exige datos en casa; C solo con un mandato claro. **Empieza por averiguar qué acepta TI** (sección 3).

---

## 3. Preguntas para TI antes de decidir

1. ¿Se pueden guardar datos de clientes en un servicio de terceros? ¿En qué país o región? ¿Hay un contrato o política que lo regule?
2. Si debe ser «en casa»: ¿hay un servidor Linux con Docker o una máquina virtual? ¿Quién lo mantiene y lo actualiza? ¿Ya hay un PostgreSQL administrado (y de qué versión)?
3. ¿Se accederá desde internet o solo desde la red interna/VPN? ¿Hay dominio y certificado HTTPS? (Sin salida a internet, `supabase-js` debe servirse localmente y la integración con Monday no funcionará.)
4. ¿Hace falta **inicio de sesión corporativo** (Microsoft/Entra ID, Active Directory)? Hoy NovaDesk usa usuarios y contraseñas propios; el inicio único (SSO) sería trabajo adicional.
5. ¿Quién respalda, cada cuánto, dónde, por cuánto tiempo, y quién prueba la restauración?
6. ¿Se necesita enviar correos (avisos)? Hoy NovaDesk no envía ninguno.
7. ¿Hay requisitos de seguridad (revisión, pruebas de penetración, política de contraseñas, registro de auditoría)?
8. ¿Qué datos van a entrar? NovaDesk le pide a la gente que **no suba datos de pacientes**; si eso cambia, hay que revisar la protección de datos.

---

## 4. Qué cambia en el código según el camino

| Elemento | A | B | C |
|---|---|---|---|
| `js/config.js`: URL y clave del proyecto, y `SITIOS` (dirección de la página) | ✔ | ✔ | ✔ |
| Ejecutar `docs/*.sql` en la base nueva (en orden) y `pruebas-permisos.sql` | ✔ | ✔ | reescribir |
| Desplegar `admin-users` y `monday-sync` + secretos | ✔ (panel de Supabase) | ✔ (copiar al stack + variables de entorno) | reescribir |
| `supabase-js` servido localmente en vez del CDN (editar la etiqueta de `index.html`; si cambia el archivo, quitar o recalcular su huella de integridad) | opcional | si no hay internet | — |
| Publicar solo `index.html`, `css/` y `js/` en el servidor web (GitHub Pages hoy publica **todo el repositorio**, incluidos `docs/` y `scripts/`; no hace falta en un servidor propio) | ✔ | ✔ | ✔ |
| `scripts/flujo.ps1` y `pre-push`: hoy «publicar» = `git push` a GitHub Pages. Para otro destino hay que agregar el paso de copia/despliegue (la regla DEV → QA → Producción se mantiene) | adaptar | adaptar | adaptar |
| Reescribir la capa de datos de `js/novadesk.js` y el simulador `dev/backend.js` | — | — | ✔ |

---

## 5. Pasos de la migración (caminos A y B)

Hazlos **primero con QA** (un servidor/proyecto de ensayo) y repite en Producción con lo aprendido.

1. **Preparar el destino:** proyecto Supabase nuevo (A) o servidor con el stack autoalojado (B), con dominio y HTTPS.
2. **Ejecutar el SQL en orden:** `schema.sql`, `migracion-02-app.sql`, `migracion-03-permisos.sql`, `migracion-04-adjuntos.sql`, `migracion-05-monday.sql`, `migracion-06-contactos.sql`. Luego `pruebas-permisos.sql`: todo debe salir ✔.
   - **Cambia la contraseña del rol `powerbi_reader` o déjalo sin acceso** antes de abrir el sistema (ver la sección 13 de la [guía del código](guia-del-codigo.md)). El `schema.sql` actual ya lo crea sin acceso (`nologin`); las versiones anteriores lo crearon con una clave de relleno conocida, así que si migras la base **desde** un proyecto antiguo, revisa ese rol en el destino.
3. **Crear el primer administrador** (usuario en Authentication + `update public.profiles set role='admin', active=true …`), igual que en [entornos.md](entornos.md).
4. **Funciones:** desplegar `admin-users` y `monday-sync` y cargar los secretos de Monday (`MONDAY_TOKEN`, `MONDAY_BOARD_ID`, `MONDAY_COLUMNS`, `MONDAY_APP_URL`…). En proyectos nuevos de la nube,
   desactivar «Verify JWT with legacy secret» en cada función (ver la guía del código, sección 8).
5. **`js/config.js`:** agregar el entorno nuevo (URL y clave publishable del destino) y la dirección de la página en `SITIOS`. Si la dirección no está en esa lista, la página no se conecta a nada.
6. **Publicar los archivos** (`index.html`, `css/`, `js/`) en el servidor web nuevo.
7. **Datos que se quieren conservar:**
   - Base de datos: copia con `pg_dump`/restauración. Según la guía oficial de restauración, la copia incluye usuarios de Auth (`auth.users`), por lo que las personas no tendrían que cambiar de contraseña.
     Ten cuidado con las **diferencias de versión de PostgreSQL** entre origen y destino (la guía oficial advierte que pueden fallar ajustes de versiones nuevas en una base más antigua).
   - Archivos adjuntos: **van aparte**. La base solo guarda sus fichas; los archivos hay que copiarlos del bucket `ticket-files` (por ejemplo con una herramienta compatible con S3, como `rclone`).
   - Ensaya el procedimiento completo en QA y mide cuánto demora.
8. **Monday:** cargar los secretos en el proyecto nuevo y poner la `MONDAY_APP_URL` nueva. Los enlaces que ya están guardados en Monday apuntan a la dirección **vieja**; se actualizan solos
   cuando cada ticket se vuelve a sincronizar (botón «Sincronizar ahora» o al modificarlo).
9. **Pruebas de aceptación en QA** (tuyas): entrar con cada rol; crear un ticket de cada tipo; mover estados; adjuntar, abrir y borrar un archivo; crear un usuario y restablecer una clave;
   confirmar el cierre por inactividad; crear y sincronizar un ítem de Monday; correr `pruebas-permisos.sql`; **restaurar un respaldo** en otro lugar para comprobar que funciona.
10. **Puesta en marcha:** acordar una ventana, dejar de usar el sistema viejo, hacer la copia final de datos (paso 7), cambiar el enlace/DNS que usa la gente y avisar.
11. **Después:** respaldos programados, monitoreo, y un responsable de actualizaciones y parches.

---

## 6. Respaldos (también hoy)

- **Qué respaldar:** la base de datos, los archivos adjuntos, y la configuración (`js/config.js` está en git; los **secretos** de las funciones y, en el autoalojado, el `.env` hay que guardarlos aparte y de forma segura).
- El plan gratuito de Supabase **no incluye respaldos automáticos** (según el diseño inicial: verifica el estado actual del plan). Hasta que esto lo defina TI, conviene una copia manual periódica con `pg_dump`.
- Un respaldo **que nunca se restauró no es un respaldo**: pruébalo.

---

## 7. Trampas frecuentes

- **Olvidar registrar la dirección nueva** en `SITIOS` de `js/config.js`: la página queda «sin conexión a ninguna base» (es a propósito).
- **Claves:** en el navegador va solo la clave *publishable*; la *secret*/`service_role` jamás. Cambiar de servidor implica claves nuevas en `js/config.js`.
- **CORS de las funciones:** hoy responden a cualquier origen (`*`); aun así exigen una sesión válida. En un entorno interno se puede restringir al dominio de la página
  (`Access-Control-Allow-Origin` en `admin-users` y `monday-sync`).
- **Versión de `supabase-js`:** está fijada (2.45.4) con huella de integridad. Si la sirves localmente, usa el mismo archivo o recalcula/quita la huella.
- **Zona horaria e idioma:** las fechas hacia Monday usan `America/Santiago` (fija en `monday-sync`) y la pantalla usa `es-CL`.
- **Dos personas editando el mismo ticket:** gana el último en guardar (ver «Límites conocidos» en la guía del código). Con más usuarios convendría mejorarlo.

---

## 8. Qué se puede preparar con anticipación y qué depende de la empresa

**Se puede preparar de antemano (desarrollo):** los cambios de código del camino A o B (`js/config.js`, copia local de `supabase-js`, adaptar `scripts/flujo.ps1` al nuevo destino), un script de respaldo y restauración
(`pg_dump` + archivos), un `docker-compose` y una guía de instalación basados en la documentación oficial de Supabase, y —si se aprueba el camino C— un diseño
del backend y de la capa de datos.

**Depende de la empresa o de TI:** aprobar el camino, crear y administrar los servidores y las cuentas, y cargar contraseñas, tokens y claves (las administra quien corresponda y **nunca** van en el repositorio).
Las **pruebas de aceptación y la QA** las hace quien mantiene el sistema; el paso 9 deja la lista de qué probar.
