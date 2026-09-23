@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Controle de Faturamento

echo.
echo ================================================
echo   Controle de Faturamento - servidor estavel
echo ================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao foi encontrado no PATH.
  echo Instale o Node.js 22 ou superior e tente novamente.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERRO: npm nao foi encontrado no PATH.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo Node: %%v
for /f "tokens=*" %%v in ('npm --version') do echo npm:  %%v

echo.
echo Encerrando apenas processos antigos deste projeto...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = [IO.Path]::GetFullPath((Get-Location).Path).TrimEnd([IO.Path]::DirectorySeparatorChar); Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

if not exist "node_modules\vinext" (
  echo Dependencias ausentes. Instalando com npm...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo ERRO: a instalacao das dependencias falhou.
    pause
    exit /b 1
  )
)

if not exist ".output\server\index.mjs" (
  echo Gerando a versao estavel do sistema. Aguarde...
  call npm run build
  if errorlevel 1 (
    echo ERRO: nao foi possivel gerar o sistema.
    pause
    exit /b 1
  )
)

set "HOST=127.0.0.1"
set "PORT=5173"

echo.
echo Sistema disponivel em http://127.0.0.1:5173
echo Para parar o servidor, pressione Ctrl+C.
echo.
call npm run start

set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo O servidor terminou com codigo %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
