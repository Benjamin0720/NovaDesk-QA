# NovaDesk - flujo de publicacion: DEV (esta carpeta) -> QA -> PRODUCCION. Siempre en ese orden.
#
#   .\scripts\flujo.cmd estado                    donde esta cada entorno
#   .\scripts\flujo.cmd configurar -UrlQA <url>   una sola vez: agrega el remoto "qa" e instala el candado de Produccion
#   .\scripts\flujo.cmd qa                        DEV -> QA          (sube lo confirmado a la pagina de QA)
#   .\scripts\flujo.cmd produccion                QA -> PRODUCCION   (solo lo que YA esta en QA y que tu confirmas que probaste)
#
# DEV es esta carpeta (se prueba en http://localhost:8123 con la base simulada). QA y Produccion son dos repositorios de GitHub
# (remotos "qa" y "origin"), cada uno publicado con GitHub Pages y conectado a su propio Supabase (ver js/config.js y docs/entornos.md).
# Todo se hace sobre la rama main y con los cambios ya confirmados (commit).
param(
  [Parameter(Position = 0)][ValidateSet('estado', 'configurar', 'qa', 'produccion')][string]$Accion = 'estado',
  [string]$UrlQA,
  [switch]$Confirmo   # "ya probe este cambio en QA": evita la pregunta (para uso automatico)
)
$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Fallo($msg) { Write-Host ''; Write-Host "X $msg" -ForegroundColor Red; exit 1 }
function Invoke-Git { & git.exe @args; if ($LASTEXITCODE -ne 0) { Fallo ('git ' + ($args -join ' ') + ' fallo (codigo ' + $LASTEXITCODE + ')') } }
function Get-Git { $r = & git.exe @args 2>$null; if ($LASTEXITCODE -ne 0) { return $null }; return (($r | Out-String).Trim()) }
function Tiene-Remoto($n) { return ((& git.exe remote) -contains $n) }
function Es-Ancestro($a, $b) { & git.exe merge-base --is-ancestor $a $b 2>$null; return ($LASTEXITCODE -eq 0) }
function Cuantos($desde, $hasta) { return [int](Get-Git rev-list --count "$desde..$hasta") }
function Corto($ref) { $s = Get-Git log -1 '--format=%h %s' $ref; if ($s) { return $s } else { return '(sin nada publicado)' } }
function Url-Pages($remoto) {   # https://github.com/usuario/repo.git -> https://usuario.github.io/repo/
  $u = Get-Git remote get-url $remoto
  if ($u -match 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$') { return "https://$($Matches[1].ToLower()).github.io/$($Matches[2])/" }
  return $u
}
function Exigir-Listo {
  $rama = Get-Git rev-parse --abbrev-ref HEAD
  if ($rama -ne 'main') { Fallo "Estas en la rama '$rama'. El flujo solo publica la rama main." }
  $sucio = Get-Git status --porcelain
  if ($sucio) { Fallo "Hay cambios sin confirmar (commit). Confirma primero lo que quieres publicar:`n$sucio" }
  if (-not (Tiene-Remoto 'qa')) { Fallo 'Falta el remoto qa. Ejecuta una vez: .\scripts\flujo.cmd configurar -UrlQA <url del repositorio de QA>' }
}

if ($Accion -eq 'configurar') {
  if (-not $UrlQA) { Fallo 'Falta -UrlQA. Ejemplo: .\scripts\flujo.cmd configurar -UrlQA https://github.com/Benjamin0720/NovaDesk-QA.git' }
  if ((Get-Git remote get-url origin) -eq $UrlQA) { Fallo 'La URL de QA es la misma de Produccion (origin). QA debe ser otro repositorio.' }
  if (Tiene-Remoto 'qa') { Invoke-Git remote set-url qa $UrlQA } else { Invoke-Git remote add qa $UrlQA }
  # Candado: el remoto origin (Produccion) solo recibe commits que ya estan en QA. Se escribe con saltos de linea LF (si no, sh lo rechaza).
  $dir = Join-Path $raiz (Get-Git rev-parse --git-path hooks)
  New-Item -ItemType Directory -Force $dir | Out-Null
  $texto = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'pre-push'))) -replace "`r`n", "`n"
  [IO.File]::WriteAllText((Join-Path $dir 'pre-push'), $texto, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'OK  Remoto qa  ->' (Get-Git remote get-url qa)
  Write-Host 'OK  Candado instalado: git no deja publicar en Produccion (origin) nada que no este ya en QA.'
  Write-Host ''
  Write-Host 'Siguiente: .\scripts\flujo.cmd qa   (sube el codigo actual a la pagina de QA)'
  exit 0
}

if ($Accion -eq 'estado') {
  if (Tiene-Remoto 'origin') { & git.exe fetch origin --quiet 2>$null }
  $hayQA = Tiene-Remoto 'qa'
  if ($hayQA) { & git.exe fetch qa --quiet 2>$null }
  $h = Get-Git rev-parse HEAD; $p = Get-Git rev-parse refs/remotes/origin/main
  $q = $null; if ($hayQA) { $q = Get-Git rev-parse refs/remotes/qa/main }
  $pend = @((Get-Git status --porcelain) -split "`n" | Where-Object { $_ }).Count
  Write-Host ''
  Write-Host ('DEV         ' + (Corto 'HEAD') + $(if ($pend) { "   (+ $pend archivo(s) sin confirmar)" } else { '' }))
  Write-Host ('QA          ' + $(if (-not $hayQA) { '(no configurado: .\scripts\flujo.cmd configurar -UrlQA <url>)' } elseif (-not $q) { '(vacio)' } else { Corto 'refs/remotes/qa/main' }))
  Write-Host ('PRODUCCION  ' + (Corto 'refs/remotes/origin/main'))
  Write-Host ''
  if ($pend) { Write-Host '- Tienes cambios sin confirmar: haz commit antes de pasar a QA.' }
  if ($hayQA) {
    if (-not $q) { Write-Host '- QA esta vacio: .\scripts\flujo.cmd qa' }
    elseif ($q -eq $h) { Write-Host '- DEV y QA estan al dia.' }
    elseif (Es-Ancestro $q $h) { Write-Host ('- DEV tiene ' + (Cuantos $q $h) + ' commit(s) que QA aun no recibe -> .\scripts\flujo.cmd qa') }
    else { Write-Host '- QA tiene commits que DEV no tiene (traelos con: git pull qa main).' }
    if ($q -and $p -ne $q) {
      if (Es-Ancestro $p $q) { Write-Host ('- QA tiene ' + (Cuantos $p $q) + ' commit(s) que Produccion aun no recibe -> pruebalos en QA y luego .\scripts\flujo.cmd produccion') }
      elseif (Es-Ancestro $q $p) { Write-Host '- ATENCION: Produccion esta ADELANTE de QA (se publico sin pasar por QA).' }
      else { Write-Host '- ATENCION: QA y Produccion tienen historias distintas.' }
    } elseif ($q) { Write-Host '- QA y Produccion estan al dia.' }
  }
  exit 0
}

Exigir-Listo

if ($Accion -eq 'qa') {
  Write-Host 'DEV -> QA ...'
  Invoke-Git push qa main
  Write-Host ''
  Write-Host ('OK  Subido a QA. Se publica en ~1 minuto en: ' + (Url-Pages 'qa'))
  Write-Host '    Pruebalo ahi. Cuando este bien: .\scripts\flujo.cmd produccion'
  exit 0
}

# --- produccion ---
if (-not (Get-Git ls-remote --heads qa main)) { Fallo 'QA esta vacio: primero sube el cambio a QA (.\scripts\flujo.cmd qa) y pruebalo ahi.' }
Invoke-Git fetch qa main --quiet
$h = Get-Git rev-parse HEAD; $q = Get-Git rev-parse refs/remotes/qa/main
if (-not (Es-Ancestro $h $q)) { Fallo "Este cambio todavia NO esta en QA.`n  1) .\scripts\flujo.cmd qa   2) pruebalo en QA   3) .\scripts\flujo.cmd produccion" }
Write-Host ('Se publicara en PRODUCCION: ' + (Corto 'HEAD'))
Write-Host ('Ya esta en QA y se puede probar en: ' + (Url-Pages 'qa'))
if (-not $Confirmo) {
  $r = Read-Host 'Probaste este cambio en QA y funciona? Escribe SI para publicar en PRODUCCION'
  if ($r -ne 'SI') { Fallo 'Cancelado. No se publico nada en Produccion.' }
}
Invoke-Git push origin main
Write-Host ''
Write-Host ('OK  Publicado en PRODUCCION: ' + (Url-Pages 'origin'))
