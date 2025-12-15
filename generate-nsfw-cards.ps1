# NSFW deck generator (adult humor, non-graphic)
# Outputs: 100 black (pick=1, no blanks) + 300 white
# Writes cards.json as UTF-8 (NO BOM)

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "The fastest way to kill the mood is when someone says: {W}.",
  "My toxic trait is thinking {W} is a personality.",
  "The group chat hasnt recovered since {W}.",
  "Nothing says romance like {W}.",
  "I cant believe I got turned on by {W}.",
  "My dating life can be summed up as: {W}.",
  "The reason Im single is definitely {W}.",
  "I should not have tried {W} after three drinks.",
  "The worst souvenir is {W}.",
  "The best kind of chaos is {W}.",
  "My love language is unfortunately {W}.",
  "I got banned for bringing {W}.",
  "My biggest red flag is {W}.",
  "The quickest way to start an argument is {W}.",
  "If you hear {W}, run.",
  "The most unhinged thing Ive ever defended is {W}.",
  "The sexiest mistake I ever made was {W}.",
  "I thought it was flirting, but it was {W}.",
  "Nothing boosts confidence like {W}.",
  "My type is basically {W}."
)

$whitePool = @(
  "Aggressive eye contact",
  "Regrettable enthusiasm",
  "A risky screenshot",
  "Zero aftercare",
  "Overconfidence with no skill",
  "A cursed situationship",
  "Drunk honesty",
  "Texting your ex by accident",
  "Talking a big game then panicking",
  "A suspiciously specific kink",
  "Unnecessary ass slapping",
  "Moaning like its a sport",
  "Calling it self care",
  "A Netflix and chill lie",
  "A spicy DM at 2am",
  "Being horny and illiterate",
  "A breakup playlist and bad choices",
  "A shame spiral",
  "Instant regret",
  "A bedroom apology tour",
  "Being emotionally unavailable but hot",
  "A vibrator with main character energy",
  "Buying lube like its groceries"
)

function Get-RandomWhite {
  $whitePool | Get-Random
}

$blackCards = @()
for ($i = 0; $i -lt $blackCount; $i++) {
  $w = Get-RandomWhite
  $t = ($blackTemplates | Get-Random).Replace("{W}", $w)
  $blackCards += @{ id = $i + 1; text = $t; pick = 1 }
}

$whiteCards = @()
for ($i = 0; $i -lt $whiteCount; $i++) {
  $base = Get-RandomWhite
  $variant = $base
  if (($i % 7) -eq 0) { $variant = "$base (allegedly)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, but louder" }
  elseif (($i % 13) -eq 0) { $variant = "$base and no shame" }

  $whiteCards += @{ id = 1001 + $i; text = $variant }
}

$data = @{ blackCards = $blackCards; whiteCards = $whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$OutPath = Join-Path $PSScriptRoot "cards.json"
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))

$size = (Get-Item $OutPath).Length
Write-Host "Generated cards.json -> black=$blackCount white=$whiteCount bytes=$size"

$pj = Get-Content -Raw $OutPath | ConvertFrom-Json
Write-Host "Verify -> black=$($pj.blackCards.Count) white=$($pj.whiteCards.Count)"
