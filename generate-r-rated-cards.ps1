# R-Rated deck generator (suggestive, adult humor, NON-GRAPHIC)
# 100 black (pick=1, no blanks) + 300 white
# Output: cards_r.json (UTF-8 no BOM)

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

# Black cards: no blanks, pick=1
$blackTemplates = @(
  "The night got awkward when {W} happened.",
  "I didnt expect the date to end with {W}.",
  "The fastest way to ruin the vibe is {W}.",
  "My friends still wont let me live down {W}.",
  "I knew it was a bad idea after {W}.",
  "Nothing kills confidence like {W}.",
  "The group chat exploded because of {W}.",
  "I should have said no to {W}.",
  "The most memorable part of the night was {W}.",
  "It was going well until {W}.",
  "My love life can be summed up as {W}.",
  "The reason Im embarrassed is {W}.",
  "I didnt plan on explaining {W} to anyone.",
  "Things escalated quickly after {W}.",
  "The worst timing imaginable was {W}.",
  "The best bad decision was {W}.",
  "I learned a lot after {W}.",
  "The story always starts with {W}.",
  "The mood shifted because of {W}.",
  "I still cringe thinking about {W}."
)

# White cards: suggestive, cheeky, NON-GRAPHIC
$whitePool = @(
  "An unplanned sleepover",
  "Awkward morning-after eye contact",
  "A risky text at midnight",
  "Mixed signals",
  "Too much confidence",
  "A misunderstood wink",
  "A bold compliment",
  "Oversharing immediately",
  "Regrettable flirting",
  "An accidental double text",
  "A dramatic pause",
  "A bad pickup line",
  "Questionable decision making",
  "A flirty joke that landed wrong",
  "Tension you could cut with a knife",
  "A very close conversation",
  "Reading the room poorly",
  "A playful dare",
  "Ignoring common sense",
  "A surprise confession",
  "A moment of intense eye contact",
  "An awkward silence",
  "A spontaneous invite",
  "A confident smile",
  "Second guessing everything",
  "A bold assumption",
  "A not-so-subtle hint",
  "Overthinking the situation",
  "A late-night conversation",
  "A risky joke",
  "A sudden change of plans",
  "An unexpected compliment",
  "A flirty misunderstanding",
  "An awkward laugh",
  "A lingering hug",
  "A questionable outfit choice",
  "A dramatic entrance",
  "A confident lie",
  "A soft rejection",
  "A curious look",
  "A playful nudge",
  "A misread signal",
  "A brave move",
  "An inside joke taken too far",
  "A casual invite with expectations",
  "A tense pause",
  "A confident shrug",
  "A too-honest answer",
  "A bold suggestion"
)

function Get-RandomWhite { $whitePool | Get-Random }

# Build black cards
$blackCards = @()
for ($i = 0; $i -lt $blackCount; $i++) {
  $w = Get-RandomWhite
  $t = ($blackTemplates | Get-Random).Replace("{W}", $w)
  $blackCards += @{ id = $i + 1; text = $t; pick = 1 }
}

# Build white cards with light variants to reach 300
$whiteCards = @()
for ($i = 0; $i -lt $whiteCount; $i++) {
  $base = Get-RandomWhite
  $variant = $base
  if (($i % 7) -eq 0) { $variant = "$base (allegedly)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, but confident" }
  elseif (($i % 13) -eq 0) { $variant = "$base and no regrets" }

  $whiteCards += @{ id = 1001 + $i; text = $variant }
}

$data = @{ blackCards = $blackCards; whiteCards = $whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$OutPath = Join-Path $PSScriptRoot "cards_r.json"
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))

$size = (Get-Item $OutPath).Length
Write-Host "Generated cards_r.json -> black=$blackCount white=$whiteCount bytes=$size"

$pj = Get-Content -Raw $OutPath | ConvertFrom-Json
Write-Host "Verify -> black=$($pj.blackCards.Count) white=$($pj.whiteCards.Count)"
