param([string]$Root='C:\ProgramData\AtlasHost')
$ErrorActionPreference='Stop'
$state=Join-Path $Root 'state'
$secrets=Join-Path $Root 'secrets'
$node=Join-Path $Root 'toolchains\node\node.exe'
if(-not (Test-Path $node)){ exit 10 }
while($true){
  try{
    $slotFile=Join-Path $state 'active-slot.txt'
    $slot='A'
    if(Test-Path $slotFile){ $slot=(Get-Content $slotFile -Raw).Trim() }
    if($slot -notin @('A','B')){ $slot='A' }
    $entry=Join-Path $Root ("slots\$slot\supervisor.js")
    if(-not (Test-Path $entry)){
      $lkg=Join-Path $state 'last-known-good-slot.txt'
      if(Test-Path $lkg){ $slot=(Get-Content $lkg -Raw).Trim(); $entry=Join-Path $Root ("slots\$slot\supervisor.js") }
    }
    if(-not (Test-Path $entry)){ throw "No healthy supervisor slot available" }

    $tokenFile=Join-Path $secrets 'github-token.dpapi'
    if(Test-Path $tokenFile){
      try{
        Add-Type -AssemblyName System.Security
        $protected=[IO.File]::ReadAllBytes($tokenFile)
        $plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
        $env:ATLAS_GH_TOKEN=[Text.Encoding]::UTF8.GetString($plain)
      }catch{ $env:ATLAS_GH_TOKEN='' }
    }
    $env:ATLAS_ROOT=$Root
    $env:ATLAS_SLOT=$slot
    & $node $entry
    $code=$LASTEXITCODE
    if($code -eq 75){ Start-Sleep -Seconds 2; continue }
  }catch{
    try{ Add-Content -Path (Join-Path $Root 'logs\launcher.log') -Value "[$([DateTime]::UtcNow.ToString('o'))] $($_.Exception.Message)" }catch{}
  }
  Start-Sleep -Seconds 5
}
