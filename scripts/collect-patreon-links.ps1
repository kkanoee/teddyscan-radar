param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [string]$Out = "patreon_links",
  [switch]$ManualLogin,
  [switch]$UseChrome,
  [switch]$Headless
)

$ErrorActionPreference = "Stop"

$bstr = [IntPtr]::Zero

try {
  if (-not $ManualLogin) {
    $email = Read-Host "Email Patreon"
    $securePassword = Read-Host "Mot de passe Patreon" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $env:PATREON_EMAIL = $email
    $env:PATREON_PASSWORD = $plainPassword
  }

  if (!(Test-Path ".\node_modules\playwright")) {
    Write-Host "Playwright introuvable localement. Installation dans node_modules..."
    npm install --no-save --no-package-lock playwright
    if ($LASTEXITCODE -ne 0) {
      throw "Installation de Playwright echouee."
    }
  }

  $nodeArgs = @(
    ".\scripts\collect-patreon-links.mjs",
    "--url", $Url,
    "--out", $Out
  )

  if ($Headless) {
    $nodeArgs += "--headless"
  }

  if ($UseChrome) {
    $nodeArgs += @("--browser-channel", "chrome")
  }

  node @nodeArgs
} finally {
  Remove-Item Env:PATREON_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:PATREON_PASSWORD -ErrorAction SilentlyContinue

  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
