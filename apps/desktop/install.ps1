# Installs the Klose desktop app on Windows:
#
#   irm https://github.com/adityakarki99/OpenKlose/releases/latest/download/install.ps1 | iex
#
# Downloads the installer from the latest GitHub release, checks it against
# the release's SHA256SUMS, installs it for the current user (no admin
# needed), and starts Klose — the first launch walks you through setup.
# Adapted from antiburn's install.ps1.
#
#   $env:KLOSE_VERSION = "0.3.0"   install that version instead of the latest
#   $env:KLOSE_NO_LAUNCH = "1"     don't start the app afterwards

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-KloseInstall {
  $repo = 'adityakarki99/OpenKlose'

  if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
    throw "Klose for Windows is built for x64 for now (this PC is $($env:PROCESSOR_ARCHITECTURE))."
  }

  Write-Host ''
  Write-Host 'Klose - a design canvas for your coding agent'
  Write-Host ''

  if ($env:KLOSE_VERSION) {
    $tag = "klose-app-v$($env:KLOSE_VERSION.TrimStart('v'))"
  } else {
    # /releases/latest redirects to the latest release's page.
    $response = Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest" -Method Head -UseBasicParsing -MaximumRedirection 5
    $final = $response.BaseResponse.ResponseUri
    if (-not $final) { $final = [Uri]$response.BaseResponse.RequestMessage.RequestUri }
    if ($final.Host -ne 'github.com') { throw "Unexpected redirect to $($final.Host)" }
    $tag = $final.Segments[-1]
  }
  if (-not $tag.StartsWith('klose-app-v')) { throw "The latest release ($tag) isn't a desktop app release." }
  $version = $tag.Substring('klose-app-v'.Length)
  Write-Host "  Release      $tag"

  $work = Join-Path ([IO.Path]::GetTempPath()) ("klose-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $asset = "Klose_${version}_x64-setup.exe"
    $base = "https://github.com/$repo/releases/download/$tag"
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile "$work\SHA256SUMS" -UseBasicParsing
    Invoke-WebRequest -Uri "$base/$asset" -OutFile "$work\$asset" -UseBasicParsing

    $line = Get-Content "$work\SHA256SUMS" | Where-Object { ($_ -split '\s+')[1] -in @($asset, "*$asset") } | Select-Object -First 1
    if (-not $line) { throw "$asset isn't listed in SHA256SUMS" }
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash "$work\$asset" -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset (expected $expected, got $actual)" }
    Write-Host "  Verified     SHA-256 of $asset"

    # The installer isn't Authenticode-signed yet, so SmartScreen may ask.
    Get-Process -Name 'Klose' -ErrorAction SilentlyContinue | Stop-Process -Force
    $install = Start-Process -FilePath "$work\$asset" -ArgumentList '/S' -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "The installer exited with code $($install.ExitCode)" }

    $exe = Join-Path $env:LOCALAPPDATA 'Klose\Klose.exe'
    if (-not (Test-Path $exe)) { throw "Klose.exe isn't where the installer should have put it ($exe)" }
    Write-Host "  Installed    $exe ($version)"

    if (-not $env:KLOSE_NO_LAUNCH) {
      Start-Process -FilePath $exe
      Write-Host ''
      Write-Host 'Klose is in your system tray. Setup opens on first launch.'
    }
    Write-Host ''
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
}

Invoke-KloseInstall
