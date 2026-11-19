# Guía de git para NovaDesk: hacer los commits uno mismo

Para quien quiera aprender a confirmar (hacer *commit*) y publicar sus cambios sin depender de nadie. Todos los comandos son para **PowerShell**, dentro de la carpeta del proyecto
(`C:\Users\benja\Desktop\NovaDesk`). Practica sin miedo: mientras no publiques (sección 4), todo lo que hagas en tu computador se puede corregir.

---

## 1. La idea en tres líneas

Git guarda «fotos» del proyecto. Un cambio pasa por tres lugares:

```
 tus archivos           área de preparación          historial
 (lo que editas)  ──►   (lo que irá en la foto)  ──►  (la foto guardada)
                git add                      git commit
```

- **Editar** un archivo no lo guarda en git. Primero lo **preparas** (`git add`) y luego lo **confirmas** (`git commit`), con un mensaje que explica qué cambió y por qué.
- Un commit vive solo en **tu computador** hasta que lo publicas. Publicar en este proyecto **no se hace con `git push`** sino con `.\scripts\flujo.cmd` (sección 4).

---

## 2. El ciclo de todos los días (cinco comandos)

Abre PowerShell en la carpeta del proyecto y sigue este orden:

```powershell
git status                      # 1) qué cambió y qué está preparado
git diff                        # 2) las líneas exactas que cambiaron (q para salir si se abre un visor)
git add docs/guia-de-git.md     # 3) prepara solo los archivos que quieres incluir
git commit -m "Agrega la guia de git"    # 4) guarda la foto con un mensaje
git log --oneline -5            # 5) comprueba: aparece tu commit arriba
```

Qué mirar en cada paso:

1. **`git status`** separa tres grupos: *Changes to be committed* (preparado), *Changes not staged* (modificado pero sin preparar) y *Untracked files* (archivos nuevos que git aún no conoce).
   Después de un commit exitoso debe decir *nothing to commit, working tree clean*.
2. **`git diff`** muestra lo modificado y aún no preparado; `git diff --staged` muestra lo que ya está preparado. `git diff --stat` da solo un resumen por archivo.
3. **`git add archivo1 archivo2`**: conviene nombrar los archivos uno a uno. `git add .` agrega todo lo de la carpeta y es fácil subir sin querer algo que no debía.
   (La carpeta `.claude/` ya está ignorada por `.gitignore`.)
4. **`git commit -m "..."`**: el mensaje es lo que verás en el historial. Guía rápida:
   - **Título corto** (hasta ~70 caracteres) que diga **qué hace** el cambio: «Agrega…», «Corrige…», «Actualiza…».
   - Este proyecto escribe los títulos **en español y sin tildes ni ñ** (así evita problemas de codificación en la consola de Windows).
   - Para agregar detalle, usa un segundo `-m`: `git commit -m "Corrige el SLA de Bupa" -m "El factor 0.75 no se aplicaba a los incidentes criticos."`
   - Un commit = **un cambio con sentido**. Mejor varios commits chicos que uno gigante.
5. **`git log --oneline -5`** lista los últimos 5 commits. `git log --oneline --decorate -8` marca además dónde están `origin/main` (Producción) y `qa/main` (QA). `git show --stat` muestra el último commit completo.

> **Aviso inofensivo:** si ves «LF will be replaced by CRLF», es solo Windows avisando de los saltos de línea. No hay que hacer nada.

---

## 3. Antes de confirmar: tres revisiones rápidas

- ¿`git status` muestra **solo** los archivos que esperabas? Si aparece algo raro, no lo agregues.
- ¿Hay **claves, tokens o contraseñas** en lo que vas a confirmar? Nunca deben entrar al repositorio (los repositorios de QA y Producción son públicos).
  Si dudas, mira `git diff --staged` antes del commit.
- ¿Probaste el cambio en DEV (`http://localhost:8123`)? El flujo es siempre **DEV → QA → Producción** (ver [entornos.md](entornos.md)).

---

## 4. Publicar: siempre con `flujo.cmd`

```powershell
.\scripts\flujo.cmd estado        # dónde está cada entorno y qué falta por pasar
.\scripts\flujo.cmd qa            # DEV -> QA: sube lo ya confirmado a la página de QA (~1 minuto)
.\scripts\flujo.cmd produccion    # QA -> PRODUCCION: solo lo que ya está en QA; pregunta si lo probaste
```

- **El árbol de trabajo debe estar limpio** (sin cambios pendientes) y estar en la rama `main`: el script se niega si no. Por eso primero se hace el commit y después se publica.
- **No uses `git push origin main` a mano**: hay un candado (`scripts/pre-push`) que bloquea subir a Producción algo que no esté en QA. Y **nunca uses `--no-verify`**: es justo saltarse esa regla.
- Si el script dice que algo no está en QA: primero `.\scripts\flujo.cmd qa`, pruébalo en la página de QA y recién entonces `produccion`.
- Si el cambio trae **SQL** o **funciones de Supabase**, se aplican primero en el Supabase de QA y después en el de Producción (ver [entornos.md](entornos.md)).

---

## 5. Cuando algo sale mal

Regla de oro: **lo que ya se publicó (QA o Producción) no se reescribe**. Lo que solo está en tu computador, sí se puede corregir.

| Situación | Qué hacer |
|---|---|
| Me equivoqué en el **mensaje del último commit** y aún **no lo publiqué** | `git commit --amend -m "Mensaje corregido"` |
| Me **olvidé de un archivo** en el último commit (aún sin publicar) | `git add archivo` y luego `git commit --amend --no-edit` |
| **Preparé un archivo por error** (`git add` de más) | `git restore --staged archivo` (sale del área de preparación, no pierde los cambios) |
| Quiero **descartar mis cambios** de un archivo y volver a la última foto | `git restore archivo` ⚠️ **esto borra tus cambios sin avisar**; mira antes con `git diff archivo` |
| Un commit **ya publicado** salió mal | `git revert <código-del-commit>` crea un commit nuevo que lo deshace. Es seguro. El código sale en `git log --oneline` (los 7 caracteres del inicio) |
| Quiero ver **cómo estaba** un archivo antes | `git log --oneline -- archivo` y luego `git show <código>:archivo` |
| Quiero ver **qué cambió** en un commit | `git show <código>` |

Comandos que **no** conviene usar sin entender bien lo que hacen (pueden perder trabajo o reescribir lo publicado): `git reset --hard`, `git push --force`, `git rebase`, `git filter-branch`.
Si crees que los necesitas, mejor primero preguntar.

---

## 6. Ramas y remotos (lo mínimo que hay que saber)

- Este proyecto trabaja **solo en la rama `main`**. El script de publicación se niega a publicar otra rama.
- Hay dos **remotos** (copias en GitHub): `origin` es **Producción** (repositorio `NovaDesk`) y `qa` es **QA** (repositorio `NovaDesk-QA`). Los ves con `git remote -v`.
- `HEAD` es «el commit en el que estás parado ahora». Cada commit tiene un código (*hash*) de 40 letras y números; basta con los primeros 7.

---

## 7. Práctica guiada (tu primer commit)

1. Abre PowerShell en la carpeta del proyecto y ejecuta `git status`: debe mostrar archivos modificados o nuevos (por ejemplo este mismo documento, si aún no se confirmó).
2. Mira qué cambió: `git diff --stat` (y `git diff` para el detalle).
3. Prepara solo lo que quieras confirmar: `git add docs/guia-de-git.md README.md`.
4. Confirma: `git commit -m "Agrega la guia de git"`.
5. Verifica: `git status` (debe decir *working tree clean*) y `git log --oneline -3` (tu commit arriba).
6. Mira dónde está cada entorno: `.\scripts\flujo.cmd estado`. Tu commit aparece como pendiente de pasar a QA.
7. **Opcional:** súbelo a QA con `.\scripts\flujo.cmd qa`. Como es solo documentación, no cambia el comportamiento de la página.

---

## 8. Chuleta

| Quiero… | Comando |
|---|---|
| Ver qué cambió | `git status` · `git diff` |
| Preparar archivos | `git add archivo1 archivo2` |
| Confirmar | `git commit -m "Titulo corto"` |
| Ver el historial | `git log --oneline -10` |
| Ver qué hay publicado dónde | `.\scripts\flujo.cmd estado` |
| Publicar en QA | `.\scripts\flujo.cmd qa` |
| Publicar en Producción | `.\scripts\flujo.cmd produccion` |
| Corregir el último mensaje (sin publicar) | `git commit --amend -m "Mensaje nuevo"` |
| Sacar un archivo de lo preparado | `git restore --staged archivo` |
| Deshacer un commit ya publicado | `git revert <código>` |

## 9. Glosario

- **Commit:** una «foto» guardada del proyecto, con autor, fecha y mensaje.
- **Árbol de trabajo (working tree):** los archivos tal como están ahora en tu carpeta.
- **Área de preparación (staging):** lo que `git add` va juntando para el próximo commit.
- **Remoto (remote):** una copia del repositorio en GitHub (`origin` = Producción, `qa` = QA).
- **Push:** subir tus commits a un remoto. Aquí lo hace `flujo.cmd`.
- **HEAD:** el commit actual.
- **Hash:** el código único de un commit.
