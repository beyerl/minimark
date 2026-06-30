# Creates a "minimark" shortcut on the Windows Desktop that launches the app.
# Run from anywhere:  npm run shortcut
# Remove it with:     npm run shortcut -- -Remove   (or just delete minimark.lnk)

param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot          # repo root (scripts/ lives under it)
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$desktop  = [Environment]::GetFolderPath('Desktop')
$lnkPath  = Join-Path $desktop 'minimark.lnk'

if ($Remove) {
  if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force; Write-Host "Removed $lnkPath" }
  else { Write-Host "No shortcut to remove." }
  return
}

if (-not (Test-Path $electron)) {
  throw "Electron not found at '$electron'. Run 'npm install' in the minimark folder first."
}

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath       = $electron
$shortcut.Arguments        = '"{0}"' -f $root          # run the app in this folder
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation     = "$electron,0"
$shortcut.Description       = 'minimark - minimal markdown editor'
$shortcut.Save()

Write-Host "Created Desktop shortcut: $lnkPath"
