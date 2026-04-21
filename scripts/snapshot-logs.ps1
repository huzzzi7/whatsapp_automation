$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogsDir = Join-Path $RepoRoot 'logs'
if (-not (Test-Path -LiteralPath $LogsDir)) {
  New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$snapshotPath = Join-Path $LogsDir "snapshot-$ts.log"
$mergedPath = Join-Path $LogsDir "merged-$ts.log"
$appLog = Join-Path $LogsDir 'app.log'

if (-not (Test-Path -LiteralPath $appLog)) {
  Write-Error "Missing $appLog - nothing to snapshot."
}

Copy-Item -LiteralPath $appLog -Destination $snapshotPath

$mergeSources = Get-ChildItem -LiteralPath $LogsDir -Filter '*.log' -File |
  Where-Object { $_.Name -notmatch '^(snapshot-|merged-)' } |
  Sort-Object LastWriteTime

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($mergedPath, '', $utf8NoBom)

function Read-LogFileShared {
  param([string]$Path, [System.Text.Encoding]$Encoding)
  $fs = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite
  )
  try {
    $reader = New-Object System.IO.StreamReader($fs, $Encoding, $true)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $fs.Dispose()
  }
}

foreach ($f in $mergeSources) {
  $text = Read-LogFileShared -Path $f.FullName -Encoding $utf8NoBom
  [System.IO.File]::AppendAllText($mergedPath, $text, $utf8NoBom)
}

function Show-FileInfo($label, $path) {
  $item = Get-Item -LiteralPath $path
  Write-Host "$label"
  Write-Host "  Path: $($item.FullName)"
  Write-Host "  Size: $($item.Length) bytes"
}

Show-FileInfo 'Snapshot (copy of app.log)' $snapshotPath
Show-FileInfo 'Merged (all operational *.log by LastWriteTime)' $mergedPath
$n = $mergeSources.Count
Write-Host ('Merge source files: ' + $n)
