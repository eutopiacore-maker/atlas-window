@echo off
setlocal
set "ATLAS_SETUP=%TEMP%\Atlas-Install-%RANDOM%.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/eutopiacore-maker/atlas-window/main/pc-node/bootstrap/Install-AtlasHost.ps1' -OutFile '%ATLAS_SETUP%'"
if errorlevel 1 (
  echo Atlas could not download the bootstrap.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ATLAS_SETUP%"
exit /b %ERRORLEVEL%
