# Entornos: DEV → QA → Producción

**Regla:** todo cambio se hace en DEV, se prueba en QA y solo después pasa a Producción. Siempre en ese orden.

| | **DEV** | **QA** | **PRODUCCIÓN** |
|---|---|---|---|
| Qué es | Tu carpeta del escritorio | Página de pruebas publicada | La página real |
| Dónde | `C:\Users\benja\Desktop\NovaDesk` → http://localhost:8123 | https://benjamin0720.github.io/NovaDesk-QA/ | https://benjamin0720.github.io/NovaDesk-Prod/ |
| Repositorio de GitHub | (el de Producción, trabajando local) | `NovaDesk-QA` — remoto `qa` | `NovaDesk-Prod` — remoto `origin` |
| Base de datos | **ninguna**: base simulada en el navegador (`dev/backend.js`) | **Supabase de QA** (proyecto aparte) | Supabase de Producción |
| Monday | simulado (`dev/monday.html`) | tablero de **ensayo** | tablero definitivo |
| Datos | de ejemplo, solo en tu navegador | de prueba | reales |
| Para qué sirve | Hacer los cambios, sin gastar cuota de nadie | Probar con una base real: permisos (RLS), Edge Functions, Monday | Usarlo de verdad |

## El flujo (siempre así)

```powershell
.\scripts\flujo.cmd estado        # dónde está cada entorno y qué falta por pasar
# 1) Haces el cambio en DEV, lo pruebas en http://localhost:8123 y lo confirmas con git (commit)
.\scripts\flujo.cmd qa            # 2) DEV -> QA: sube lo confirmado a la página de QA (se publica en ~1 minuto)
# 3) Pruebas en la página de QA (y, si el cambio trae SQL o funciones, primero se aplican en el Supabase de QA)
.\scripts\flujo.cmd produccion    # 4) QA -> PRODUCCIÓN: solo lo que ya está en QA, y te pregunta si lo probaste
```

El script y un candado de git hacen cumplir el orden:
- `flujo.cmd produccion` **se niega** si el commit actual todavía no está en QA, o si hay cambios sin confirmar, o si no estás en `main`.
- Un `git push origin main` a mano también se bloquea si lo que subes no está en QA (candado `scripts/pre-push`, que instala `flujo.cmd configurar`).
  Existe `git push --no-verify` para saltárselo: es justo lo que la regla prohíbe, no lo uses.
- Los candados viven en tu computador. No protegen contra alguien que suba a GitHub desde otro lugar.

**Cambios de base de datos (SQL) y funciones.** Se aplican primero en el Supabase de **QA**, se prueban ahí (incluido `docs/pruebas-permisos.sql`, que debe salir todo ✔)
y solo al pasar a Producción se aplican en el Supabase real, **antes** de `flujo.cmd produccion`. Las migraciones se escriben para poder ejecutarse antes de publicar el código.
Con las Edge Functions igual: se despliegan en QA, se prueban y luego en Producción (cada proyecto tiene sus propios secretos).

## Cómo sabe cada página a qué base conectarse

El código es el mismo en los tres entornos. [js/config.js](../js/config.js) elige la configuración según la dirección donde está publicado:
`localhost` → DEV (base simulada; su URL es falsa a propósito, así DEV jamás puede tocar un Supabase real), `…/NovaDesk-QA/` → QA, `…/NovaDesk-Prod/` → Producción (el repositorio de Producción se llamaba `NovaDesk` hasta el 20-nov-2026; `js/config.js` aún acepta ese nombre antiguo y se puede quitar cuando ya no se use).
Una dirección que no esté en esa lista **no recibe ninguna configuración** (se desconecta): una copia o un fork nunca toca Producción.
Fuera de Producción se ve siempre dónde estás: `[DEV]`/`[QA]` en el título y, en QA, una franja «🧪 QA · datos de prueba».
Las claves *publishable* son públicas por diseño; la clave *secret*/service_role **nunca** va en el código.

## Crear QA por primera vez (una sola vez)

**A. GitHub — repositorio de QA**
1. Crea un repositorio **público y vacío** llamado `NovaDesk-QA` (sin README, sin .gitignore, sin licencia). Debe ser público para usar GitHub Pages gratis,
   así que la página de QA es visible para cualquiera: no pongas datos reales ahí.
2. En el repositorio: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*.

**B. Supabase — proyecto de QA** (el plan gratuito permite 2 proyectos activos a la vez)
1. Crea un proyecto nuevo, p. ej. `novadesk-qa`.
2. En *SQL Editor*, ejecuta **en este orden**: `docs/schema.sql`, `docs/migracion-02-app.sql`, `docs/migracion-03-permisos.sql`, `docs/migracion-04-adjuntos.sql`,
   `docs/migracion-05-monday.sql`, `docs/migracion-06-contactos.sql`. Después ejecuta `docs/pruebas-permisos.sql`: todas las líneas deben salir con ✔.
3. Crea el primer administrador: *Authentication → Users → Add user* con el correo `<tu-usuario>@novadesk.local` y una clave (marca *Auto Confirm User*), y promuévelo:
   `update public.profiles set role='admin', active=true where username='<tu-usuario>';`
4. Deja la autenticación configurada igual que en Producción (por ejemplo, con el registro público de usuarios desactivado).
5. Despliega la Edge Function `admin-users` (`supabase functions deploy admin-users --project-ref <ref-de-QA>`, o pegándola en el Dashboard).
   Si vas a probar Monday: `monday-sync` y sus secretos, apuntando a un **tablero de ensayo** (ver [integracion-monday.md](integracion-monday.md)).

**C. Conectar la página de QA a su Supabase**
1. En el proyecto de QA: *Project Settings → API* → copia la **Project URL** y la clave **publishable** (nunca la *secret*).
2. En `js/config.js`, entorno `qa`, reemplaza los `PENDIENTE` por esos dos valores (mientras sean `PENDIENTE`, la página de QA muestra «falta configurar su Supabase»).

**D. Conectar el flujo en tu computador**
```powershell
.\scripts\flujo.cmd configurar -UrlQA https://github.com/Benjamin0720/NovaDesk-QA.git
.\scripts\flujo.cmd qa
```
Con eso queda el remoto `qa`, el candado instalado y el código actual publicado en QA.

## Cada cuánto cambia qué (resumen)

- **Cambio de pantalla o lógica:** DEV → `flujo qa` → prueba → `flujo produccion`.
- **Cambio con SQL:** además, ejecutar el SQL en Supabase de QA antes de probar, y en el de Producción antes de `flujo produccion`.
- **Cambio con Edge Function:** además, desplegarla en QA antes de probar, y en Producción antes de `flujo produccion`.
