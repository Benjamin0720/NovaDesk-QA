# Integración con Monday

Cada ticket de NovaDesk puede estar vinculado a **un** ítem de Monday. La idea: un solo tablero **«Mesa de ayuda»** en Monday con todos
los tickets (de todos los clientes y proyectos), para que la gerencia comercial los vea ahí sin entrar a NovaDesk.

- **Solo va de NovaDesk hacia Monday.** NovaDesk es la fuente de verdad; lo que cambia en el ticket (estado, prioridad, técnico…) se
  refleja en el ítem. Si alguien edita el ítem en Monday, NovaDesk no se entera (y la próxima sincronización lo pisa).
- **Dos formas de vincular** (tarjeta «Monday» dentro del ticket, solo analista y administrador):
  1. **Pegar el enlace** de un ítem que ya existe en Monday. Funciona sin configurar nada en el servidor. Si el ítem es de otro tablero
     (p. ej. un proyecto) queda solo como referencia y NovaDesk no le toca las columnas.
  2. **Crear ítem en Monday**: NovaDesk crea el ítem en el tablero «Mesa de ayuda» y lo vincula. Requiere la configuración de abajo.
- El técnico ve el enlace en sus tickets, pero no puede vincular ni quitarlo.
- **Qué se manda:** número, asunto (como nombre del ítem), cliente, tipo, prioridad, estado, técnico, fecha de creación, fecha de
  resolución y un enlace de vuelta al ticket. **La descripción y los comentarios NO se mandan** (pueden traer datos sensibles de clientes).
- El token de Monday vive solo como secreto en el servidor (Edge Function `monday-sync`); nunca llega al navegador.

## Monday en cada entorno (DEV → QA → Producción)

Los entornos y el flujo están en [entornos.md](entornos.md). Para Monday significan:

| Entorno | Supabase | Monday |
|---|---|---|
| **DEV** (tu carpeta, localhost) | ninguno (base simulada) | **simulado** (`dev/monday.html`); la tarjeta y «Crear ítem en Monday» siempre están disponibles |
| **QA** (página de QA) | proyecto de QA | **tablero de ENSAYO** de Monday, con el token y los IDs de ese tablero como secretos del proyecto de QA |
| **Producción** | proyecto real | el **tablero definitivo** «Mesa de ayuda», con secretos propios del proyecto real |

Cada proyecto de Supabase tiene sus **propios secretos** (`MONDAY_TOKEN`, `MONDAY_BOARD_ID`, `MONDAY_COLUMNS`…): así QA nunca escribe en el tablero real.
DEV **no** prueba los permisos de la base (RLS) ni la conexión real con Monday; eso se prueba en QA.
La pantalla tolera que la tabla `ticket_links` no exista (entonces no muestra la tarjeta de Monday), así que el código se puede publicar antes o después de la migración.

Orden para llevar Monday de un entorno al siguiente:

1. **DEV:** probar el cambio con la base simulada.
2. **QA:** ejecutar `docs/migracion-05-monday.sql` en el SQL Editor del Supabase de QA y luego `docs/pruebas-permisos.sql` (debe salir todo ✔);
   configurar y publicar la Edge Function en ese proyecto (siguiente sección, con el tablero de ensayo); `.\scripts\flujo.cmd qa`; probar en la página de QA.
3. **Producción:** repetir la migración y la función en el Supabase real (con el tablero definitivo) y recién entonces `.\scripts\flujo.cmd produccion`.

## Configurar «Crear ítem en Monday» (una sola vez)

1. **En Monday**, crear el tablero «Mesa de ayuda» con estas columnas (los nombres son libres; el tipo importa):

   | Dato de NovaDesk | Tipo de columna sugerido | Clave en `MONDAY_COLUMNS` | `type` |
   |---|---|---|---|
   | Número (`I-0001`) | Texto | `id` | `text` |
   | Cliente | Estado (o Texto) | `client` | `status` |
   | Tipo (Requerimiento/Incidente/Cambio) | Estado | `type` | `status` |
   | Prioridad | Estado | `priority` | `status` |
   | Estado | Estado | `status` | `status` |
   | Técnico | Texto | `assignee` | `text` |
   | Fecha de creación | Fecha | `created` | `date` |
   | Fecha de resolución | Fecha | `resolved` | `date` |
   | Enlace al ticket | Enlace | `link` | `link` |

   Tipos aceptados: `text`, `status`, `dropdown`, `date`, `link`. Las columnas son opcionales: la que no esté en `MONDAY_COLUMNS` no se manda.
   Las etiquetas de las columnas de Estado se crean solas la primera vez (el token debe poder modificar el tablero).
   Para el gerente comercial: un **dashboard** de Monday sobre este tablero (tickets por cliente, abiertos vs. cerrados, por prioridad);
   según el plan de Monday puede que los dashboards tengan límites.
2. **Token:** crear un usuario dedicado en Monday (p. ej. «NovaDesk», con acceso al tablero) y generar su token de API
   (Monday > avatar > Developers > My access tokens). Así las acciones no aparecen a nombre de una persona. **No lo pegues en el chat ni en el código.**
3. **ID del tablero:** el número de la URL del tablero (`…/boards/123456789`).
4. **ID de cada columna:** en Monday, menú ⋯ de la columna > *Copiar ID de columna* (algo como `color_mkabc123`; el nombre exacto de la opción puede variar según la versión de Monday).
5. **Secretos en Supabase** (Dashboard > Edge Functions > Secrets, o `supabase secrets set`):

   | Secreto | Valor |
   |---|---|
   | `MONDAY_TOKEN` | el token del paso 2 |
   | `MONDAY_BOARD_ID` | el número del paso 3 |
   | `MONDAY_COLUMNS` | JSON con los IDs del paso 4 (ejemplo abajo) |
   | `MONDAY_APP_URL` | (opcional) URL pública de NovaDesk en Producción (la de tu sitio publicado, no la de localhost); se guarda en la columna `link` como `…/#I-0001` y abre ese ticket al entrar |
   | `MONDAY_GROUP_ID` | (opcional) grupo del tablero donde nacen los ítems |
   | `MONDAY_API_VERSION` | (opcional) versión de la API de Monday; si falta se usa la estable por defecto |

   ```json
   {
     "id":       { "id": "text_mkabc123",  "type": "text"   },
     "client":   { "id": "color_mkabc124", "type": "status" },
     "type":     { "id": "color_mkabc125", "type": "status" },
     "priority": { "id": "color_mkabc126", "type": "status" },
     "status":   { "id": "color_mkabc127", "type": "status" },
     "assignee": { "id": "text_mkabc128",  "type": "text"   },
     "created":  { "id": "date_mkabc129",  "type": "date"   },
     "resolved": { "id": "date_mkabc130",  "type": "date"   },
     "link":     { "id": "link_mkabc131",  "type": "link"   }
   }
   ```
6. **Publicar la función:** `supabase functions deploy monday-sync` (o crearla en el Dashboard pegando `supabase/functions/monday-sync/index.ts`).
7. Recargar NovaDesk: en un ticket sin vínculo aparece el botón **＋ Crear ítem en Monday**. Mientras la función no esté lista, la tarjeta
   solo ofrece pegar el enlace y avisa que la creación automática no está activa.

## Cómo se mantiene al día

Cuando un ticket vinculado cambia algo que Monday muestra (asunto, cliente, tipo, prioridad, estado, técnico, resolución), la app llama a
la función ~2 s después de guardar, en segundo plano. La tarjeta muestra «Sincronizado hace…» o el último error, y el botón
**↻ Sincronizar ahora** reintenta. Si Monday falla, el ticket **no** se pierde ni se bloquea: solo queda marcado el error.

Limitaciones conocidas:
- Si un ticket se reabre, Monday conserva la fecha de resolución anterior (la función no la borra).
- Quitar el vínculo **no** borra el ítem en Monday.
- Un ticket tiene como máximo un ítem de Monday.
- La función no se ha probado contra una cuenta real de Monday todavía (se probó la pantalla con un servidor simulado); la primera
  prueba real conviene hacerla en un tablero de ensayo.

## Probar y deshacer

- Permisos: `docs/pruebas-permisos.sql` (20 pruebas nuevas de `ticket_links`; no deja nada guardado).
- Deshacer: ver el final de `docs/migracion-05-monday.sql`.
