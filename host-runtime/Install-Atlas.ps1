param(
  [Parameter(Mandatory=$true)][string]$TelemetryTopic,
  [string]$Root = "$env:ProgramData\Atlas",
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Is-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
if (-not (Is-Admin)) { throw 'Atlas bootstrap must run elevated. The one-click launcher should request this automatically.' }

$RepoRaw = 'https://raw.githubusercontent.com/eutopiacore-maker/atlas-window/main'
$LogDir = Join-Path $Root 'logs'
$StateDir = Join-Path $Root 'state'
$ConfigDir = Join-Path $Root 'config'
$ControlDir = Join-Path $Root 'control'
$UiDir = Join-Path $Root 'ui'
$WorldDir = Join-Path $Root 'world'
$SlotsDir = Join-Path $Root 'slots'
$ToolsDir = Join-Path $Root 'tools'
$NodeDir = Join-Path $ToolsDir 'node'
$Temp = Join-Path $env:TEMP ('atlas-bootstrap-' + [Guid]::NewGuid().ToString('N'))
$BootstrapLog = Join-Path $LogDir 'bootstrap.log'

$dirs = @($Root,$LogDir,$StateDir,$ConfigDir,$ControlDir,$UiDir,$WorldDir,$SlotsDir,$ToolsDir,$Temp)
foreach($d in $dirs){ New-Item -ItemType Directory -Force -Path $d | Out-Null }
function Log([string]$m){ $line=(Get-Date).ToString('o')+' '+$m; Add-Content -Path $BootstrapLog -Value $line; Write-Host $m }
function Download([string]$url,[string]$dest){
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest -TimeoutSec 90
}
function Verify-Sha256([string]$file,[string]$expected){
  if(-not $expected){ return }
  $actual=(Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLowerInvariant()
  if($actual -ne $expected.ToLowerInvariant()){ throw "SHA256 mismatch: $file" }
}
function Atomic-Text([string]$file,[string]$text){
  $tmp=$file+'.tmp-'+[Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp,$text,[Text.UTF8Encoding]::new($false))
  Move-Item -Force $tmp $file
}
function Get-Json([string]$url){ return Invoke-RestMethod -UseBasicParsing -Uri $url -TimeoutSec 60 }

try {
  Log 'Atlas bootstrap: preflight'
  $arch = $env:PROCESSOR_ARCHITECTURE
  if($arch -eq 'AMD64'){ $nodeArch='x64' }
  elseif($arch -eq 'ARM64'){ $nodeArch='arm64' }
  else { throw "Unsupported Windows architecture: $arch" }
  $os = Get-CimInstance Win32_OperatingSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors
  $gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion)
  $preflight=[ordered]@{ at=(Get-Date).ToString('o'); architecture=$arch; os=$os.Caption; osVersion=$os.Version; cpu=$cpu; gpu=$gpu }
  $preflight | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $StateDir 'preflight.json')

  Log 'Resolving portable Node.js runtime'
  $index = Get-Json 'https://nodejs.org/dist/index.json'
  $release = $index | Where-Object { $_.version -like 'v24.*' -and $_.lts } | Select-Object -First 1
  if(-not $release){ $release = $index | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1 }
  if(-not $release){ throw 'Could not resolve a Node.js v24 release.' }
  $ver=$release.version
  $zipName="node-$ver-win-$nodeArch.zip"
  $base="https://nodejs.org/dist/$ver"
  $sums=(Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -TimeoutSec 60).Content -split "`n"
  $line=$sums | Where-Object { $_ -match [regex]::Escape($zipName)+'$' } | Select-Object -First 1
  if(-not $line){ throw "Node checksum not found for $zipName" }
  $expected=($line -split '\s+')[0].Trim().ToLowerInvariant()
  $nodeZip=Join-Path $Temp $zipName
  Download "$base/$zipName" $nodeZip
  Verify-Sha256 $nodeZip $expected
  $nodeExtract=Join-Path $Temp 'node'
  Expand-Archive -Force -Path $nodeZip -DestinationPath $nodeExtract
  $nodeTop=Get-ChildItem $nodeExtract -Directory | Select-Object -First 1
  if(-not $nodeTop){ throw 'Node archive layout invalid.' }
  if(Test-Path $NodeDir){ Remove-Item -Recurse -Force $NodeDir }
  New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
  Copy-Item -Recurse -Force (Join-Path $nodeTop.FullName '*') $NodeDir
  if(-not (Test-Path (Join-Path $NodeDir 'node.exe'))){ throw 'node.exe missing after extraction.' }
  Log "Portable Node installed: $ver"

  Log 'Installing Atlas runtime A/B slots'
  $rel=Get-Json "$RepoRaw/host-runtime/release.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  foreach($slot in @('A','B')){
    $slotDir=Join-Path $SlotsDir $slot
    if(Test-Path $slotDir){ Remove-Item -Recurse -Force $slotDir }
    New-Item -ItemType Directory -Force -Path $slotDir | Out-Null
    foreach($f in $rel.files){
      $dest=Join-Path $slotDir $f.path
      Download "$RepoRaw/$($f.source)" $dest
      Verify-Sha256 $dest $f.sha256
    }
  }
  Atomic-Text (Join-Path $Root 'current-slot.txt') "A`n"

  $launcher=Join-Path $Root 'launcher.ps1'
  Download "$RepoRaw/$($rel.launcher.source)" $launcher
  Verify-Sha256 $launcher $rel.launcher.sha256

  Log 'Installing Atlas desktop shell'
  $uiFile=Join-Path $UiDir 'host.html'
  Download "$RepoRaw/$($rel.ui.source)" $uiFile
  Verify-Sha256 $uiFile $rel.ui.sha256

  Log 'Installing local Eutopia world assets'
  $worldAssets=@('world-engine.js','geodata-node.js','regional-nature-node.js','landscape-phase.js','nature-source-registry.json','world.html','index.html','dynamics.html','dynamics.js','appearance.html','appearance-scene.js','appearance-decoder.json')
  foreach($name in $worldAssets){ Download "$RepoRaw/$name" (Join-Path $WorldDir $name) }
  if(-not (Test-Path (Join-Path $WorldDir 'world-state.json'))){ Download "$RepoRaw/world-state.json" (Join-Path $WorldDir 'world-state.json') }
  New-Item -ItemType Directory -Force -Path (Join-Path $WorldDir 'vendor') | Out-Null
  $three=Join-Path $WorldDir 'vendor\three.module.js'
  Download 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js' $three
  $dyn=Join-Path $WorldDir 'dynamics.html'
  $dynText=[IO.File]::ReadAllText($dyn).Replace('https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js','./vendor/three.module.js')
  Atomic-Text $dyn $dynText

  Log 'Creating durable node identity'
  $configFile=Join-Path $ConfigDir 'node.json'
  $existing=$null
  if(Test-Path $configFile){ try{ $existing=Get-Content $configFile -Raw | ConvertFrom-Json }catch{} }
  $nodeId = if($existing.nodeId){$existing.nodeId}else{'atlas-'+([Guid]::NewGuid().ToString('N'))}
  $cfg=[ordered]@{ schema=1; nodeId=$nodeId; telemetryTopic=$TelemetryTopic; repo='eutopiacore-maker/atlas-window'; createdAt=if($existing.createdAt){$existing.createdAt}else{(Get-Date).ToString('o')}; bootstrapVersion=$rel.version }
  Atomic-Text $configFile (($cfg|ConvertTo-Json -Depth 5)+"`n")

  Log 'Registering autonomous Atlas Host supervisor'
  $taskName='Atlas Host'
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcher`""
  $trigger=New-ScheduledTaskTrigger -AtStartup
  $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName

  Log 'Creating Atlas application shortcuts'
  $edgeCandidates=@(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $edge=$edgeCandidates | Select-Object -First 1
  $shell=New-Object -ComObject WScript.Shell
  $shortcutTargets=@(
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Atlas.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs\Atlas.lnk')
  )
  foreach($lnk in $shortcutTargets){
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnk) | Out-Null
    $sc=$shell.CreateShortcut($lnk)
    if($edge){ $sc.TargetPath=$edge; $sc.Arguments='--app=http://127.0.0.1:8765/ --start-maximized' }
    else { $sc.TargetPath="$env:SystemRoot\System32\cmd.exe"; $sc.Arguments='/c start "" http://127.0.0.1:8765/' }
    $sc.WorkingDirectory=$Root; $sc.Description='Atlas · Eutopia Host'; $sc.Save()
  }

  Log 'Waiting for autonomous host health check'
  $healthy=$false; $status=$null
  for($i=0;$i -lt 90;$i++){
    try{ $status=Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2; if($status.state -eq 'RUNNING'){ $healthy=$true; break } }catch{}
    Start-Sleep -Seconds 1
  }
  if(-not $healthy){ throw 'Atlas Host did not become healthy within 90 seconds. Bootstrap left logs and A/B slots for recovery.' }
  Log "Atlas Host healthy: node=$($status.nodeId) version=$($status.hostVersion)"
  $receipt=[ordered]@{ schema=1; installedAt=(Get-Date).ToString('o'); nodeId=$status.nodeId; hostVersion=$status.hostVersion; nodeVersion=$ver; root=$Root; task=$taskName; healthy=$true }
  Atomic-Text (Join-Path $StateDir 'install-receipt.json') (($receipt|ConvertTo-Json -Depth 5)+"`n")

  if(-not $NoLaunch){
    if($edge){ Start-Process -FilePath $edge -ArgumentList '--app=http://127.0.0.1:8765/','--start-maximized' }
    else { Start-Process 'http://127.0.0.1:8765/' }
  }
  Log 'Atlas installation complete.'
  Write-Host ''
  Write-Host 'ATLAS_READY' -ForegroundColor Green
}
catch{
  Log ('BOOTSTRAP_FAILED: '+$_.Exception.Message)
  throw
}
finally{
  try{ if(Test-Path $Temp){ Remove-Item -Recurse -Force $Temp } }catch{}
}
