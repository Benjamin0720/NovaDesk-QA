@echo off
rem NovaDesk - atajo para ejecutar flujo.ps1 sin tener que cambiar la politica de scripts de PowerShell.
rem Uso:  .\scripts\flujo.cmd estado | configurar -UrlQA <url> | qa | produccion
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0flujo.ps1" %*
