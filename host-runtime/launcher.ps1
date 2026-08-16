# Atlas Host stable launcher. Keep this file deliberately small.
$ErrorActionPreference = 'Stop'
$Root = if ($env:ATLAS_ROOT) { $env:ATLAS_ROOT } else { Join-Path $env:ProgramData 'Atlas' }
$Node = Join-Path $Root 'tools\node\node.exe'
$SlotFile = Join-Path $Root 'current-slot.txt'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-Slot {
  try { $s = (Get-Content $SlotFile -Raw).Trim().ToUpperInvariant(); if ($s -eq 'B') { return 'B' } } catch {}
  return 'A'
}
function Set-Slot([string]$s) { [IO.File]::WriteAllText($SlotFile, $s + "`n") }
function Write-LauncherLog([string]$m) { Add-Content -Path (Join-Path $LogDir 'launcher.log') -Value ((Get-Date).ToString('o') + ' ' + $m) }

if (-not (Test-Path $Node)) { Write-LauncherLog 'node.exe missing'; exit 50 }
$rapidFailures = 0
while ($true) {
  $slot = Get-Slot
  $hostJs = Join-Path $Root ("slots\{0}\atlas-host.js" -f $slot)
  if (-not (Test-Path $hostJs)) {
    $other = if ($slot -eq 'A') { 'B' } else { 'A' }
    $otherJs = Join-Path $Root ("slots\{0}\atlas-host.js" -f $other)
    if (Test-Path $otherJs) { Set-Slot $other; Write-LauncherLog "missing slot $slot, rolled to $other"; continue }
    Write-LauncherLog 'no healthy runtime slot'; exit 51
  }
  $started = Get-Date
  & $Node $hostJs
  $code = $LASTEXITCODE
  $seconds = ((Get-Date) - $started).TotalSeconds
  if ($code -eq 0) { Write-LauncherLog 'host exited cleanly; restarting after 3 seconds'; Start-Sleep -Seconds 3; continue }
  if ($code -eq 42) { $rapidFailures = 0; Write-LauncherLog 'host requested controlled restart'; Start-Sleep -Seconds 2; continue }
  if ($seconds -lt 45) { $rapidFailures++ } else { $rapidFailures = 0 }
  Write-LauncherLog "host exit=$code runtimeSeconds=$([math]::Round($seconds,1)) rapidFailures=$rapidFailures"
  if ($rapidFailures -ge 3) {
    $other = if ($slot -eq 'A') { 'B' } else { 'A' }
    $otherJs = Join-Path $Root ("slots\{0}\atlas-host.js" -f $other)
    if (Test-Path $otherJs) {
      Set-Slot $other
      Write-LauncherLog "automatic rollback $slot -> $other"
      $rapidFailures = 0
    }
  }
  Start-Sleep -Seconds 5
}
