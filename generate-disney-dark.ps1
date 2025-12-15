# Dark Disney deck generator (creepy, twisted, NON-NSFW)
# 100 black + 300 white | pick=1 | no blanks
# Output: cards_disney_dark.json (UTF-8 NO BOM)

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "The fairytale ended differently because of {W}.",
  "Nobody talks about what really happened after {W}.",
  "The happiest place on earth stopped smiling at {W}.",
  "The curse was supposed to be temporary until {W}.",
  "The magic kingdom has a rule against {W}.",
  "The song stopped abruptly when {W} appeared.",
  "The castle gates closed after {W}.",
  "The sidekick warned everyone about {W}.",
  "The wish came true, but at the cost of {W}.",
  "The magic mirror refused to show {W}.",
  "The parade went silent because of {W}.",
  "The storybook ending was rewritten by {W}.",
  "The villain wasnt wrong about {W}.",
  "The spell book was banned after {W}.",
  "The kingdom never recovered from {W}.",
  "The happily ever after was delayed by {W}.",
  "The transformation went wrong due to {W}.",
  "The fine print mentioned {W}.",
  "The forest went quiet when {W} happened.",
  "The narrator avoided explaining {W}."
)

$whitePool = @(
  "Mickey Mouse staring without blinking",
  "A smiling character who should not be smiling",
  "A princess questioning everything",
  "A cursed wishing well",
  "A talking animal that knows too much",
  "A castle hallway that never ends",
  "A forgotten fairy godmother",
  "A broken magic wand",
  "A song that should not be sung",
  "A character frozen mid-smile",
  "A happily ever after that feels wrong",
  "A shadow that moves on its own",
  "A villain who made valid points",
  "A sidekick left behind",
  "A spell with missing pages",
  "A magic mirror that lies",
  "A crown that feels heavy",
  "A parade at the wrong time",
  "A theme song playing slowly",
  "A forest that watches back",
  "A kingdom built on secrets",
  "A talking object begging to stop",
  "A door labeled do not open",
  "A character who never got a sequel",
  "A rewritten prophecy",
  "A smiling mascot at midnight",
  "A wish that could not be undone",
  "A happily ever after on pause",
  "A prince who never returned",
  "A glass slipper that does not fit",
  "A voice stolen forever",
  "A contract written in glitter",
  "A spell that worked too well",
  "A castle with locked rooms",
  "A fairytale narrator hesitating",
  "A character trapped offscreen",
  "A kingdom that pretends nothing happened",
  "A cheerful tune in a minor key",
  "A shadow behind the curtain",
  "A magic that stopped feeling magical",
  "A parade float that should not move",
  "A smiling face in the crowd",
  "A character waving too slowly",
  "A happily ever after nobody earned",
  "A magic book that reads you back",
  "A castle light turning off",
  "A fairytale reboot gone wrong",
  "A talking animal who stopped talking",
  "A wish echoing back",
  "A happily ever after with conditions"
)

function Get-RandomWhite { $whitePool | Get-Random }

# Build black cards
$blackCards = @()
for ($i = 0; $i -lt $blackCount; $i++) {
  $t = ($blackTemplates | Get-Random).Replace("{W}", (Get-RandomWhite))
  $blackCards += @{ id = $i + 1; text = $t; pick = 1 }
}

# Build white cards (300 entries with light variants)
$whiteCards = @()
for ($i = 0; $i -lt $whiteCount; $i++) {
  $base = Get-RandomWhite
  $variant = $base
  if (($i % 7) -eq 0) { $variant = "$base (somehow)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, but darker" }
  elseif (($i % 13) -eq 0) { $variant = "$base and nobody explained it" }

  $whiteCards += @{ id = 1001 + $i; text = $variant }
}

$data = @{ blackCards = $blackCards; whiteCards = $whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$OutPath = Join-Path $PSScriptRoot "cards_disney_dark.json"
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_disney_dark.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $OutPath).Length)"
