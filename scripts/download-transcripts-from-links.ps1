param(
  [string]$LinksPath = "patreon_links\video_links.txt",
  [string]$CookiesPath = "$env:USERPROFILE\Downloads\youtube_cookies.txt",
  [int]$DelaySeconds = 15
)

$ErrorActionPreference = "Continue"

$OutDir = Join-Path $env:USERPROFILE "Documents\Transcripts\Patreon"
$null = New-Item -ItemType Directory -Force -Path $OutDir
$archive = Join-Path $OutDir "downloaded_ids_fr_orig.txt"
$logFile = Join-Path $OutDir "run_log.txt"

if (!(Test-Path $LinksPath)) {
  Write-Error "Liste de liens introuvable: $LinksPath"
  exit 1
}

if (!(Test-Path $CookiesPath)) {
  Write-Error "Cookies YouTube introuvables: $CookiesPath"
  exit 1
}

$urls = Get-Content $LinksPath |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -match '^https?://' } |
  Select-Object -Unique

if (-not $urls -or $urls.Count -eq 0) {
  Write-Error "Aucun lien video trouve dans: $LinksPath"
  exit 1
}

"[$(Get-Date -Format s)] Start Patreon transcript run: $($urls.Count) urls" | Out-File -FilePath $logFile -Append -Encoding utf8

for ($i = 0; $i -lt $urls.Count; $i++) {
  $url = $urls[$i]

  Write-Host "`n[$($i + 1)/$($urls.Count)] $url"
  "[$(Get-Date -Format s)] Processing $url" | Out-File -FilePath $logFile -Append -Encoding utf8

  py -m yt_dlp `
    --skip-download `
    --ignore-no-formats-error `
    --write-sub --write-auto-sub `
    --sub-langs "fr-orig" `
    --sub-format srt `
    --cookies "$CookiesPath" `
    --download-archive "$archive" `
    -o "$OutDir\%(upload_date)s - %(title).120s [%(id)s].%(ext)s" `
    "$url"

  if ($LASTEXITCODE -ne 0) {
    "[$(Get-Date -Format s)] ERROR on $url" | Out-File -FilePath $logFile -Append -Encoding utf8
  } else {
    "[$(Get-Date -Format s)] OK $url" | Out-File -FilePath $logFile -Append -Encoding utf8
  }

  if ($i -lt ($urls.Count - 1)) {
    Start-Sleep -Seconds $DelaySeconds
  }
}

"[$(Get-Date -Format s)] End Patreon transcript run" | Out-File -FilePath $logFile -Append -Encoding utf8
Write-Host "`nTermine. Resultats: $OutDir"
