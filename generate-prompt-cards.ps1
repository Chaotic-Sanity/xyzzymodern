$ErrorActionPreference = "Stop"

function Read-Int {
  param(
    [string]$Prompt,
    [int]$Default
  )

  $raw = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }

  $n = 0
  if ([int]::TryParse($raw, [ref]$n)) { return $n }
  return $Default
}

function Pick-Random {
  param([array]$Items)
  if (-not $Items -or $Items.Count -eq 0) { return "" }
  return ($Items | Get-Random)
}

function Build-BlackText {
  param(
    [string]$Theme,
    [array]$Seeds,
    [int]$Index
  )

  $starter = @(
    "The wildest part of $Theme was ___",
    "Nobody expected ___ during $Theme",
    "$Theme peaked when ___ happened",
    "The reason $Theme failed: ___",
    "My only plan for $Theme was ___",
    "I cant explain why $Theme needed ___",
    "$Theme got out of control after ___",
    "The official sponsor of $Theme is ___"
  ) | Get-Random

  if ($Seeds.Count -gt 0 -and ($Index % 3 -eq 0)) {
    $seed = Pick-Random $Seeds
    return "$starter ($seed)"
  }
  return $starter
}

function Build-WhiteText {
  param(
    [string]$Theme,
    [array]$Seeds,
    [int]$Index
  )

  if ($Seeds.Count -gt 0 -and ($Index % 2 -eq 0)) {
    $seed = Pick-Random $Seeds
    $modRoll = Get-Random -Minimum 0 -Maximum 6
    if ($modRoll -eq 0) { return "$seed" }
    if ($modRoll -eq 1) { return "$seed but louder" }
    if ($modRoll -eq 2) { return "$seed on live TV" }
    if ($modRoll -eq 3) { return "$seed at 3AM" }
    if ($modRoll -eq 4) { return "$seed for no reason" }
    return "$seed with confidence"
  }

  $fallback = @(
    "an unhinged group chat",
    "a cursed PowerPoint",
    "the wrong button",
    "zero impulse control",
    "an accidental confession",
    "a chaotic side quest",
    "an illegal amount of glitter",
    "the main character complex",
    "a suspiciously specific playlist",
    "a dramatic overreaction"
  ) | Get-Random

  return "$fallback in $Theme"
}

Write-Host ""
Write-Host "=== Prompt Card Generator ==="
Write-Host ""

$deckName = Read-Host "Deck name"
if ([string]::IsNullOrWhiteSpace($deckName)) { $deckName = "prompt_deck" }

$themePrompt = Read-Host "Describe the vibe/topic for this deck"
if ([string]::IsNullOrWhiteSpace($themePrompt)) { $themePrompt = "absolute chaos" }

$blackCount = Read-Int -Prompt "How many black cards?" -Default 100
$whiteCount = Read-Int -Prompt "How many white cards?" -Default 300

if ($blackCount -lt 1) { $blackCount = 1 }
if ($whiteCount -lt 1) { $whiteCount = 1 }

$seedInput = Read-Host "Optional seed phrases (comma-separated, press Enter to skip)"
$seedPhrases = @()
if (-not [string]::IsNullOrWhiteSpace($seedInput)) {
  $seedPhrases = $seedInput.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
}

$safeFileName = ($deckName -replace '[^\w\-]+', "_").Trim("_")
if ([string]::IsNullOrWhiteSpace($safeFileName)) { $safeFileName = "prompt_deck" }
$outFile = Join-Path $PSScriptRoot ("cards_" + $safeFileName + ".json")

$blackCards = @()
for ($i = 0; $i -lt $blackCount; $i++) {
  $blackCards += @{
    id   = $i + 1
    text = Build-BlackText -Theme $themePrompt -Seeds $seedPhrases -Index $i
    pick = 1
  }
}

$whiteCards = @()
for ($i = 0; $i -lt $whiteCount; $i++) {
  $whiteCards += @{
    id   = 1001 + $i
    text = Build-WhiteText -Theme $themePrompt -Seeds $seedPhrases -Index $i
  }
}

$deck = @{
  name       = $deckName
  prompt     = $themePrompt
  blackCards = $blackCards
  whiteCards = $whiteCards
}

$json = $deck | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Done."
Write-Host "Deck: $deckName"
Write-Host "Prompt: $themePrompt"
Write-Host "Black cards: $blackCount"
Write-Host "White cards: $whiteCount"
Write-Host "Output: $outFile"

