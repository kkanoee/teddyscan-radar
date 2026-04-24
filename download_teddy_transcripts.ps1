# C:\Users\kano\Documents\Transcripts\download_teddy_transcripts.ps1
param(
  [string]$ChannelUrl = "https://www.youtube.com/@TeddyboyRSA/streams",
  [string]$CookiesPath = "$env:USERPROFILE\Downloads\youtube_cookies.txt",
  [int]$DelaySeconds = 15
)

$ErrorActionPreference = "Continue"

# Dossier de sortie FORCÉ
$OutDir = Join-Path $env:USERPROFILE "Documents\Transcripts"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$archive = Join-Path $OutDir "downloaded_ids_fr_orig.txt"
$logFile = Join-Path $OutDir "run_log.txt"

if (!(Test-Path $CookiesPath)) {
  Write-Error "Cookies introuvables: $CookiesPath"
  exit 1
}

"[$(Get-Date -Format s)] Start run" | Out-File -FilePath $logFile -Append -Encoding utf8

# Récupère tous les IDs de /streams
$ids = py -m yt_dlp --flat-playlist --print "%(id)s" "$ChannelUrl" 2>$null |
  Where-Object { $_ -match '^[A-Za-z0-9_-]{11}$' } |
  Select-Object -Unique

if (-not $ids -or $ids.Count -eq 0) {
  "[$(Get-Date -Format s)] Aucune vidéo trouvée." | Out-File -FilePath $logFile -Append -Encoding utf8
  exit 1
}

for ($i = 0; $i -lt $ids.Count; $i++) {
  $id = $ids[$i]
  $url = "https://www.youtube.com/watch?v=$id"

  Write-Host "`n[$($i+1)/$($ids.Count)] $url"
  "[$(Get-Date -Format s)] Processing $id" | Out-File -FilePath $logFile -Append -Encoding utf8

  # IMPORTANT: fr-orig uniquement
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
    "[$(Get-Date -Format s)] ERROR on $id" | Out-File -FilePath $logFile -Append -Encoding utf8
  } else {
    "[$(Get-Date -Format s)] OK $id" | Out-File -FilePath $logFile -Append -Encoding utf8
  }

  if ($i -lt ($ids.Count - 1)) {
    Start-Sleep -Seconds $DelaySeconds
  }
}

"[$(Get-Date -Format s)] End run" | Out-File -FilePath $logFile -Append -Encoding utf8
Write-Host "`nTerminé. Résultats: $OutDir"
