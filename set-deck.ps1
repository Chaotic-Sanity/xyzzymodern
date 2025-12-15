param(
  [Parameter(Mandatory=$true)]
  [string]$Deck
)

$map = @{
  "nsfw"        = "cards.json"
  "r"           = "cards_r.json"
  "dark"        = "cards_dark.json"
  "clean"       = "cards_clean.json"
  "aussie"      = "cards_aussie.json"
  "horror"      = "cards_horror.json"
  "marvel_nsfw" = "cards_marvel_nsfw.json"
  "dc_nsfw"     = "cards_dc_nsfw.json"
  "disney_dark" = "cards_disney_dark.json"
}

if (-not $map.ContainsKey($Deck)) {
  Write-Host "Unknown deck '$Deck'. Options:" -ForegroundColor Yellow
  $map.Keys | Sort-Object | ForEach-Object { Write-Host "  $_" }
  exit 1
}

$src = Join-Path $PSScriptRoot $map[$Deck]

if (-not (Test-Path $src)) {
  Write-Host "Deck file not found: $src" -ForegroundColor Red
  exit 1
}

Copy-Item $src (Join-Path $PSScriptRoot "cards.json") -Force

node -e "const d=require('./cards.json'); console.log('ACTIVE -> black:',d.blackCards.length,'white:',d.whiteCards.length);"
Write-Host "Active deck set to: $Deck" -ForegroundColor Green
