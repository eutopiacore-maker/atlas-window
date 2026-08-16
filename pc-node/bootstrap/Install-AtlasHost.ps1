param([switch]$DryRun)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Repo='eutopiacore-maker/atlas-window'
$Root='C:\ProgramData\AtlasHost'
$Raw="https://raw.githubusercontent.com/$Repo/main"
$TaskName='Atlas Host Supervisor'
$BootstrapVersion='0.1.1'

function Is-Admin {
  $id=[Security.Principal.WindowsIdentity]::GetCurrent()
  $p=New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Say([string]$s){ Write-Host "[Atlas] $s" -ForegroundColor Cyan }
function Ensure-Dir([string]$p){ if(-not(Test-Path $p)){ New-Item -ItemType Directory -Path $p -Force | Out-Null } }
function Download([string]$url,[string]$out){ Ensure-Dir (Split-Path $out -Parent); Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out }
function RawFile([string]$repoPath,[string]$out){ Download "$Raw/$repoPath" $out }

if($DryRun){
  if($PSVersionTable.PSVersion.Major -lt 5){ throw 'PowerShell 5+ required' }
  Say 'Dry-run OK: bootstrap syntax and Windows plan are valid.'
  exit 0
}

if(-not(Is-Admin)){
  Say 'Solicitando permiso de administrador para la instalación inicial…'
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$dirs=@('bootstrap','toolchains','slots\A','slots\B','rescue','state','secrets','logs','cache','web','world','addons')
foreach($d in $dirs){ Ensure-Dir (Join-Path $Root $d) }
$txn=Join-Path $Root 'state\bootstrap-transaction.json'
@{startedAt=[DateTime]::UtcNow.ToString('o');state='installing';version=$BootstrapVersion} | ConvertTo-Json | Set-Content -Encoding UTF8 $txn

try{
  Say 'Instalando el runtime base según el hardware de esta PC…'
  $machineArch=$env:PROCESSOR_ARCHITECTURE
  $nodeArch=if($machineArch -eq 'ARM64'){'arm64'}else{'x64'}
  $nodeBase='https://nodejs.org/dist/latest-v22.x'
  $sums=(Invoke-WebRequest -UseBasicParsing "$nodeBase/SHASUMS256.txt").Content
  $line=($sums -split "`n" | Where-Object { $_ -match "node-v.+-win-$nodeArch\.zip$" } | Select-Object -First 1).Trim()
  if(-not $line){ throw "No compatible Node build for $nodeArch" }
  $parts=$line -split '\s+'; $expected=$parts[0].ToLower(); $zipName=$parts[-1]
  $nodeZip=Join-Path $Root "cache\$zipName"; Download "$nodeBase/$zipName" $nodeZip
  if((Get-FileHash -Algorithm SHA256 $nodeZip).Hash.ToLower() -ne $expected){ throw 'Node SHA256 verification failed' }
  $nodeStage=Join-Path $Root 'toolchains\node-stage'; Remove-Item $nodeStage -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive $nodeZip $nodeStage -Force
  $inner=(Get-ChildItem $nodeStage -Directory | Select-Object -First 1).FullName
  $nodeDir=Join-Path $Root 'toolchains\node'; Remove-Item $nodeDir -Recurse -Force -ErrorAction SilentlyContinue; Move-Item $inner $nodeDir; Remove-Item $nodeStage -Recurse -Force -ErrorAction SilentlyContinue
  $nodeExe=Join-Path $nodeDir 'node.exe'; if(-not(Test-Path $nodeExe)){ throw 'Node installation failed' }

  Say 'Preparando el vínculo permanente con Atlas…'
  $release=Invoke-RestMethod -Headers @{'User-Agent'='Atlas-Bootstrap'} 'https://api.github.com/repos/cli/cli/releases/latest'
  $ghPattern=if($nodeArch -eq 'arm64'){'windows_arm64.zip$'}else{'windows_amd64.zip$'}
  $asset=$release.assets | Where-Object { $_.name -match $ghPattern } | Select-Object -First 1
  if(-not $asset){ throw 'No compatible GitHub CLI package found' }
  $ghZip=Join-Path $Root "cache\$($asset.name)"; Download $asset.browser_download_url $ghZip
  $ghStage=Join-Path $Root 'toolchains\gh-stage'; Remove-Item $ghStage -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive $ghZip $ghStage -Force
  $ghExe=(Get-ChildItem $ghStage -Filter gh.exe -Recurse | Select-Object -First 1).FullName; if(-not $ghExe){ throw 'GitHub CLI extraction failed' }

  Say 'GitHub se abrirá una sola vez para autorizar este nodo. Después Atlas opera sin pedirte instalaciones técnicas.'
  & $ghExe auth login --hostname github.com --git-protocol https --web --scopes public_repo
  if($LASTEXITCODE -ne 0){ throw 'GitHub enrollment was not completed' }
  $token=(& $ghExe auth token).Trim(); if(-not $token){ throw 'GitHub token unavailable after enrollment' }
  $env:GH_TOKEN=$token; & $ghExe api "repos/$Repo" | Out-Null; if($LASTEXITCODE -ne 0){ throw 'The enrolled GitHub account cannot access the Atlas repository' }

  Add-Type -AssemblyName System.Security
  $protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($token),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  $tokenFile=Join-Path $Root 'secrets\github-token.dpapi'; [IO.File]::WriteAllBytes($tokenFile,$protected)
  & icacls $tokenFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue

  Say 'Instalando supervisor, mundo persistente y sistema de Add-ons…'
  $slotA=Join-Path $Root 'slots\A'; Remove-Item "$slotA\*" -Recurse -Force -ErrorAction SilentlyContinue
  foreach($f in @('supervisor.js','world-runtime.js','addon-manager.js')){ RawFile "pc-node/runtime/$f" (Join-Path $slotA $f) }
  @{version='0.1.1';generation=2;installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $slotA 'version.json')
  $stableLauncher=Join-Path $Root 'bootstrap\run-supervisor.ps1'; RawFile 'pc-node/runtime/run-supervisor.ps1' $stableLauncher
  Remove-Item (Join-Path $Root 'rescue\*') -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item "$slotA\*" (Join-Path $Root 'rescue') -Recurse -Force
  'A' | Set-Content -Encoding ASCII (Join-Path $Root 'state\active-slot.txt'); 'A' | Set-Content -Encoding ASCII (Join-Path $Root 'state\last-known-good-slot.txt')

  foreach($js in @('supervisor.js','world-runtime.js','addon-manager.js')){
    & $nodeExe --check (Join-Path $slotA $js); if($LASTEXITCODE -ne 0){ throw "$js syntax check failed" }
    & $nodeExe (Join-Path $slotA $js) --self-test; if($LASTEXITCODE -ne 0){ throw "$js self-test failed" }
  }

  foreach($f in @('host.html','index.html','world.html','world.js','dynamics.html','dynamics.js','appearance.html','appearance-scene.js','appearance-decoder.json','eutopia-detail.js')){ try{ RawFile $f (Join-Path $Root "web\$f") }catch{} }
  RawFile 'addons/catalog.json' (Join-Path $Root 'web\addons-catalog.json')

  Say 'Registrando Atlas para inicio y recuperación automática con Windows…'
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$stableLauncher`" -Root `"$Root`""
  $trigger=New-ScheduledTaskTrigger -AtStartup
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

  $edgeCandidates=@("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  $edge=$edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  $wsh=New-Object -ComObject WScript.Shell; $lnkPath=Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Atlas.lnk'; $lnk=$wsh.CreateShortcut($lnkPath)
  if($edge){ $lnk.TargetPath=$edge; $lnk.Arguments='--app=http://127.0.0.1:8765/ --no-first-run' }else{ $lnk.TargetPath='powershell.exe'; $lnk.Arguments='-NoProfile -WindowStyle Hidden -Command "Start-Process http://127.0.0.1:8765/"' }
  $lnk.WorkingDirectory=$Root; $lnk.Description='Atlas Host'; $lnk.Save()

  Start-ScheduledTask -TaskName $TaskName
  Say 'Probando Host, mundo causal y recuperación…'
  $healthy=$false; $status=$null
  for($i=0;$i -lt 45;$i++){ Start-Sleep 1; try{$status=Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:8765/api/status' -TimeoutSec 2;if($status.nodeId){$healthy=$true;break}}catch{} }
  if(-not $healthy){ throw 'Atlas Host did not become healthy' }

  Say 'Probando una instalación real de Add-on sin intervención técnica…'
  Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:8765/api/addons/install' -Method Post -ContentType 'application/json' -Body '{"id":"atlas.host.diagnostics"}' -TimeoutSec 5 | Out-Null
  $addonHealthy=$false
  for($i=0;$i -lt 45;$i++){ Start-Sleep 1; try{$r=Get-Content (Join-Path $Root 'addons\installed.json') -Raw | ConvertFrom-Json;if($r.addons.'atlas.host.diagnostics'.healthy){$addonHealthy=$true;break}}catch{} }
  if(-not $addonHealthy){ throw 'Add-on end-to-end validation failed' }

  Say 'Verificando que Eutopia tomó el reloj causal local…'
  $worldHealthy=$false
  for($i=0;$i -lt 90;$i++){ Start-Sleep 1; try{$s=Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:8765/api/status' -TimeoutSec 2;if($s.world.state -in @('IDLE','RUNNING','CATCHING_UP','WAITING_NETWORK')){$worldHealthy=$true;break}}catch{} }
  if(-not $worldHealthy){ throw 'Persistent world runtime did not become healthy' }

  @{startedAt=(Get-Content $txn -Raw | ConvertFrom-Json).startedAt;completedAt=[DateTime]::UtcNow.ToString('o');state='installed';version=$BootstrapVersion;nodeId=$status.nodeId;validated=@('supervisor','world-runtime','addon-install')} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $txn
  Say 'Atlas Host quedó instalado y validado.'
  Start-Process $lnkPath
}
catch{
  Say "La instalación no pasó sus pruebas: $($_.Exception.Message)"
  try{ Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }catch{}
  @{failedAt=[DateTime]::UtcNow.ToString('o');state='failed';error=$_.Exception.Message;version=$BootstrapVersion} | ConvertTo-Json | Set-Content -Encoding UTF8 $txn
  throw
}
