param(
  [switch]$Portable,
  [string]$DataDir,
  [ValidateRange(1, 65535)][int]$Port = 4917,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$taskMutex = $null
$taskHasLock = $false

function Read-Ready([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
  }
  return $null
}

function Test-Ready($Ready, [string]$NodePath, [string]$ExpectedDataDir, [string]$ExpectedVersion, [string]$ReadyPath) {
  if ($null -eq $Ready -or $null -eq $Ready.pid) { return $false }
  $taskRunning = Get-Process -Id ([int]$Ready.pid) -ErrorAction SilentlyContinue
  if ($null -eq $taskRunning) { return $false }
  # A reused PID, different checkout, or stale file must never open another process's host link.
  $taskFileTime = (Get-Item -LiteralPath $ReadyPath).LastWriteTimeUtc
  if ($taskRunning.StartTime.ToUniversalTime() -gt $taskFileTime.AddSeconds(2)) { return $false }
  $taskCommand = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$Ready.pid)
  if ($null -eq $taskCommand -or !$taskCommand.CommandLine.Contains($ReadyPath)) { return $false }
  if ($taskRunning.Path -ne $NodePath -or $Ready.version -ne $ExpectedVersion -or $Ready.dataDir -ne $ExpectedDataDir) {
    throw 'Another copy or version is running with this data folder. Stop it from its application menu before launching this version.'
  }
  $taskUri = [Uri]$Ready.url
  if ($taskUri.Scheme -ne 'http' -or $taskUri.Host -ne '127.0.0.1' -or $taskUri.Port -ne [int]$Ready.port -or $taskUri.Fragment -notmatch '^#host=[A-Za-z0-9_-]{20,}$') {
    throw 'The local server readiness file contains an invalid host link.'
  }
  try {
    $taskHealth = Invoke-RestMethod -Uri ($taskUri.GetLeftPart([UriPartial]::Authority) + '/api/health') -TimeoutSec 2
    return $taskHealth.ok -eq $true -and $taskHealth.version -eq $ExpectedVersion
  } catch { return $false }
}

try {
  $taskAppDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
  $taskNode = Join-Path $taskAppDir 'runtime\node.exe'
  $taskServer = Join-Path $taskAppDir 'dist\server\server\index.js'
  if (!(Test-Path -LiteralPath $taskNode) -or !(Test-Path -LiteralPath $taskServer)) {
    throw 'The application files are incomplete. Extract the entire ZIP before launching.'
  }
  $taskVersion = (Get-Content -LiteralPath (Join-Path $taskAppDir 'package.json') -Raw | ConvertFrom-Json).version
  if ($DataDir) { $taskDataDir = [System.IO.Path]::GetFullPath($DataDir) }
  elseif ($Portable) { $taskDataDir = Join-Path $taskAppDir 'data' }
  else { $taskDataDir = Join-Path $env:LOCALAPPDATA 'ArkhamHorrorDigital' }
  $taskDataDir = [System.IO.Path]::GetFullPath($taskDataDir).TrimEnd('\')
  [System.IO.Directory]::CreateDirectory($taskDataDir) | Out-Null

  # Credentials and server logs remain in this Windows user's profile even with portable data.
  $taskLocalRuntime = Join-Path $env:LOCALAPPDATA 'ArkhamHorrorDigital\launcher'
  [System.IO.Directory]::CreateDirectory($taskLocalRuntime) | Out-Null
  # Build a fresh DACL rather than reapplying inherited audit entries (which can
  # require SeSecurityPrivilege under PowerShell 7 on a second launch).
  $taskAcl = New-Object System.Security.AccessControl.DirectorySecurity
  $taskAcl.SetAccessRuleProtection($true, $false)
  $taskOwner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskRule = New-Object System.Security.AccessControl.FileSystemAccessRule($taskOwner, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $taskAcl.SetAccessRule($taskRule)
  $taskRuntimeDirectory = [System.IO.DirectoryInfo]::new($taskLocalRuntime)
  if ($PSVersionTable.PSEdition -eq 'Core') {
    [System.IO.FileSystemAclExtensions]::SetAccessControl($taskRuntimeDirectory, $taskAcl)
  } else {
    $taskRuntimeDirectory.SetAccessControl($taskAcl)
  }
  $taskSha = [System.Security.Cryptography.SHA256]::Create()
  try { $taskKey = ([BitConverter]::ToString($taskSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskDataDir.ToLowerInvariant())))).Replace('-', '').Substring(0, 20) }
  finally { $taskSha.Dispose() }
  $taskReadyPath = Join-Path $taskLocalRuntime ($taskKey + '.json')
  $taskMutex = New-Object System.Threading.Mutex($false, ('Local\ArkhamHorrorDigital-' + $taskKey))
  try { $taskHasLock = $taskMutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $taskHasLock = $true }
  if (!$taskHasLock) { throw 'Another launcher is starting this campaign server. Wait a moment and try again.' }
  $taskReady = Read-Ready $taskReadyPath
  if (Test-Ready $taskReady $taskNode $taskDataDir $taskVersion $taskReadyPath) {
    if (!$NoBrowser) { Start-Process -FilePath $taskReady.url }
    Write-Output ('Arkham Horror Digital is already running on port ' + $taskReady.port + '.')
    exit 0
  }
  if (Test-Path -LiteralPath $taskReadyPath) { Remove-Item -LiteralPath $taskReadyPath }
  $taskStdout = Join-Path $taskLocalRuntime ($taskKey + '-output.log')
  $taskStderr = Join-Path $taskLocalRuntime ($taskKey + '-error.log')
  $taskArgs = @(('"' + $taskServer + '"'), '--data-dir', ('"' + $taskDataDir + '"'), '--port', [string]$Port, '--ready-file', ('"' + $taskReadyPath + '"'))
  $taskProcess = Start-Process -FilePath $taskNode -ArgumentList $taskArgs -WorkingDirectory $taskAppDir -WindowStyle Hidden -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr -PassThru
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
  $taskStarted = $false
  while ([DateTime]::UtcNow -lt $taskDeadline) {
    $taskProcess.Refresh()
    if ($taskProcess.HasExited) {
      $taskDetails = if (Test-Path -LiteralPath $taskStderr) { (Get-Content -LiteralPath $taskStderr -Tail 6) -join [Environment]::NewLine } else { '' }
      throw ('The local server could not start. Port ' + $Port + ' may already be in use. ' + $taskDetails)
    }
    $taskReady = Read-Ready $taskReadyPath
    if ($null -ne $taskReady -and [int]$taskReady.pid -eq $taskProcess.Id -and (Test-Ready $taskReady $taskNode $taskDataDir $taskVersion $taskReadyPath)) { $taskStarted = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (!$taskStarted) {
    if (!$taskProcess.HasExited) { $taskProcess.Kill() }
    throw ('The local server did not become ready. See logs in ' + $taskLocalRuntime)
  }
  if (!$NoBrowser) { Start-Process -FilePath $taskReady.url }
  Write-Output ('Arkham Horror Digital started on port ' + $taskReady.port + '. Data: ' + $taskDataDir)
  Write-Output ('Readiness file: ' + $taskReadyPath)
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($taskHasLock) { $taskMutex.ReleaseMutex() }
  if ($null -ne $taskMutex) { $taskMutex.Dispose() }
}
