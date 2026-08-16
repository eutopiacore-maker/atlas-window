param([switch]$DryRun)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Repo='eutopiacore-maker/atlas-window'
$Root='C:\ProgramData\AtlasHost'
$Raw="https://raw.githubusercontent.com/$Repo/main"
$TaskName='Atlas Host Supervisor'

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
  Say 'Dry-run: bootstrap syntax and platform plan OK.'
  if($PSVersionTable.PSVersion.Major -lt 5){ throw 'PowerShell 5+ required' }
  exit 0
}

if(-not(Is-Admin)){
  Say 'Solicitando permiso de administrador para la instalación inicial…'
  $args="-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell.exe -Verb RunAs -ArgumentList $args
  exit
}

Say 'Preparando Atlas Host…'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$dirs=@('bootstrap','toolchains','slots\A','slots\B','rescue','state','secrets','logs','cache','web','world','addons')
foreach($d in $dirs){ Ensure-Dir (Join-Path $Root $d) }

# Transaction marker: if the machine loses power during bootstrap, the next run knows installation was incomplete.
$txn=Join-Path $Root 'state\bootstrap-transaction.json'
@{startedAt=[DateTime]::UtcNow.ToString('o');state='installing';version='0.1.0'} | ConvertTo-Json | Set-Content -Encoding UTF8 $txn

try{
  # Portable Node.js: selected dynamically from the official latest v22 channel and SHA-verified.
  Say 'Detectando arquitectura e instalando el runtime base…'
  $arch=$env:PROCESSOR_ARCHITECTURE
  $nodeArch=if($arch -eq 'ARM64'){'arm64'}else{'x64'}
  $nodeBase='https://nodejs.org/dist/latest-v22.x'
  $sums=(Invoke-WebRequest -UseBasicParsing "$nodeBase/SHASUMS256.txt").Content
  $line=($sums -split "`n" | Where-Object { $_ -match "node-v.+-win-$nodeArch\.zip$" } | Select-Object -First 1).Trim()
  if(-not $line){ throw "No compatible Node build for $nodeArch" }
  $parts=$line -split '\s+'
  $expected=$parts[0].ToLower(); $zipName=$parts[-1]
  $nodeZip=Join-Path $Root "cache\$zipName"
  Download "$nodeBase/$zipName" $nodeZip
  $actual=(Get-FileHash -Algorithm SHA256 $nodeZip).Hash.ToLower()
  if($actual -ne $expected){ throw 'Node SHA256 verification failed' }
  $nodeStage=Join-Path $Root 'toolchains\node-stage'
  Remove-Item $nodeStage -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $nodeZip $nodeStage -Force
  $inner=(Get-ChildItem $nodeStage -Directory | Select-Object -First 1).FullName
  $nodeDir=Join-Path $Root 'toolchains\node'
  Remove-Item $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $inner $nodeDir
  Remove-Item $nodeStage -Recurse -Force -ErrorAction SilentlyContinue
  $nodeExe=Join-Path $nodeDir 'node.exe'
  if(-not(Test-Path $nodeExe)){ throw 'Node installation failed' }

  # GitHub CLI is used only for the one-time browser enrollment. The resulting token is machine-encrypted.
  Say 'Preparando el vínculo seguro con el repositorio de Atlas…'
  $release=Invoke-RestMethod -Headers @{'User-Agent'='Atlas-Bootstrap'} 'https://api.github.com/repos/cli/cli/releases/latest'
  $ghPattern=if($nodeArch -eq 'arm64'){'windows_arm64.zip$'}else{'windows_amd64.zip$'}
  $asset=$release.assets | Where-Object { $_.name -match $ghPattern } | Select-Object -First 1
  if(-not $asset){ throw 'No compatible GitHub CLI package found' }
  $ghZip=Join-Path $Root "cache\$($asset.name)"
  Download $asset.browser_download_url $ghZip
  $ghStage=Join-Path $Root 'toolchains\gh-stage'
  Remove-Item $ghStage -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $ghZip $ghStage -Force
  $ghExe=(Get-ChildItem $ghStage -Filter gh.exe -Recurse | Select-Object -First 1).FullName
  if(-not $ghExe){ throw 'GitHub CLI extraction failed' }

  Say 'Se abrirá GitHub una sola vez para enlazar esta PC con Atlas.'
  & $ghExe auth login --hostname github.com --git-protocol https --web --scopes public_repo
  if($LASTEXITCODE -ne 0){ throw 'GitHub enrollment was not completed' }
  $token=(& $ghExe auth token).Trim()
  if(-not $token){ throw 'GitHub token unavailable after enrollment' }
  $env:GH_TOKEN=$token
  & $ghExe api "repos/$Repo" | Out-Null
  if($LASTEXITCODE -ne 0){ throw 'The enrolled GitHub account cannot access the Atlas repository' }

  Add-Type -AssemblyName System.Security
  $plain=[Text.Encoding]::UTF8.GetBytes($token)
  $protected=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  $tokenFile=Join-Path $Root 'secrets\github-token.dpapi'
  [IO.File]::WriteAllBytes($tokenFile,$protected)
  & icacls $tokenFile /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  & $ghExe auth logout --hostname github.com --user ((& $ghExe api user --jq .login) 2>$null) 2>$null | Out-Null

  # Initial A slot. From this point onward the supervisor updates itself A/B without rerunning bootstrap.
  Say 'Instalando el supervisor, recuperación y mundo persistente…'
  $slotA=Join-Path $Root 'slots\A'
  foreach($f in @('supervisor.js','world-runtime.js','run-supervisor.ps1')){
    RawFile "pc-node/runtime/$f" (Join-Path $slotA $f)
  }
  @{version='0.1.0';generation=1;installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $slotA 'version.json')
  Remove-Item (Join-Path $Root 'rescue\*') -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item "$slotA\*" (Join-Path $Root 'rescue') -Recurse -Force
  'A' | Set-Content -Encoding ASCII (Join-Path $Root 'state\active-slot.txt')
  'A' | Set-Content -Encoding ASCII (Join-Path $Root 'state\last-known-good-slot.txt')

  & $nodeExe --check (Join-Path $slotA 'supervisor.js')
  if($LASTEXITCODE -ne 0){ throw 'Supervisor syntax check failed' }
  & $nodeExe --check (Join-Path $slotA 'world-runtime.js')
  if($LASTEXITCODE -ne 0){ throw 'World runtime syntax check failed' }
  & $nodeExe (Join-Path $slotA 'supervisor.js') --self-test
  if($LASTEXITCODE -ne 0){ throw 'Supervisor self-test failed' }
  & $nodeExe (Join-Path $slotA 'world-runtime.js') --self-test
  if($LASTEXITCODE -ne 0){ throw 'World runtime self-test failed' }

  # Local desktop content is cached. The supervisor keeps it synchronized later.
  foreach($f in @('host.html','index.html','world.html','world.js','dynamics.html','dynamics.js','appearance.html','appearance-scene.js','appearance-decoder.json','eutopia-detail.js')){
    try{ RawFile $f (Join-Path $Root "web\$f") }catch{}
  }
  try{ RawFile 'addons/catalog.json' (Join-Path $Root 'web\addons-catalog.json') }catch{}

  # SYSTEM startup task: this is the durable privileged substrate. New add-ons do not ask for UAC again.
  Say 'Registrando Atlas para que arranque y se recupere solo con Windows…'
  $launcher=Join-Path $slotA 'run-supervisor.ps1'
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -Root `"$Root`""
  $trigger=New-ScheduledTaskTrigger -AtStartup
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

  # Start menu shell. It is an installed local application surface, while the service remains independent underneath.
  $edgeCandidates=@("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  $edge=$edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  $shell=New-Object -ComObject WScript.Shell
  $lnkPath=Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Atlas.lnk'
  $lnk=$shell.CreateShortcut($lnkPath)
  if($edge){ $lnk.TargetPath=$edge; $lnk.Arguments='--app=http://127.0.0.1:8765/ --no-first-run' }
  else{ $lnk.TargetPath='powershell.exe'; $lnk.Arguments='-NoProfile -WindowStyle Hidden -Command "Start-Process http://127.0.0.1:8765/"' }
  $lnk.WorkingDirectory=$Root; $lnk.Description='Atlas Host'; $lnk.Save()

  Start-ScheduledTask -TaskName $TaskName
  Say 'Verificando que el Host Node quedó vivo…'
  $healthy=$false
  for($i=0;$i -lt 30;$i++){
    Start-Sleep -Seconds 1
    try{
      $s=Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:8765/api/status' -TimeoutSec 2
      if($s.nodeId){ $healthy=$true; break }
    }catch{}
  }
  if(-not $healthy){ throw 'Atlas Host did not become healthy after installation' }

  @{startedAt=(Get-Content $txn -Raw | ConvertFrom-Json).startedAt;completedAt=[DateTime]::UtcNow.ToString('o');state='installed';version='0.1.0'} | ConvertTo-Json | Set-Content -Encoding UTF8 $txn
  Say 'Atlas Host quedó instalado y el supervisor está activo.'
  Start-Process $lnkPath
}
catch{
  Say "La instalación no pasó sus pruebas: $($_.Exception.Message)"
  try{ Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }catch{}
  @{failedAt=[DateTime]::UtcNow.ToString('o');state='failed';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding UTF8 $txn
  throw
}
