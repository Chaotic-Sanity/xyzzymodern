# Clean deck generator (PG / family-friendly)
# 100 black + 300 white | pick=1 | UTF-8 NO BOM
# Output: cards_clean.json

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "The most unexpected part of the day was {W}.",
  "I didnt plan for {W} to happen.",
  "Everyone was surprised by {W}.",
  "The highlight of the event was {W}.",
  "Things got interesting after {W}.",
  "The real challenge turned out to be {W}.",
  "Nobody expected {W}.",
  "The funniest moment involved {W}.",
  "Everything changed because of {W}.",
  "The situation improved thanks to {W}.",
  "The awkward moment was caused by {W}.",
  "The best memory is {W}.",
  "The most confusing part was {W}.",
  "This is how the story begins: {W}.",
  "The crowd reacted to {W}.",
  "The problem was solved by {W}.",
  "The unexpected solution was {W}.",
  "The turning point was {W}.",
  "The day will be remembered for {W}.",
  "The surprise guest was {W}."
)

$whitePool = @(
  "A wrong turn",
  "A happy accident",
  "An unexpected announcement",
  "A surprise visit",
  "A confusing sign",
  "A dramatic pause",
  "An overenthusiastic wave",
  "A misunderstanding",
  "A sudden idea",
  "An awkward introduction",
  "A confident guess",
  "A last-minute change",
  "A cheerful mistake",
  "A group photo",
  "A bold decision",
  "A spilled drink",
  "A forgotten password",
  "An unexpected email",
  "A surprise gift",
  "A confusing instruction",
  "A loud sneeze",
  "A funny coincidence",
  "An early start",
  "A late arrival",
  "A missing sock",
  "A typo",
  "A nervous laugh",
  "An inside joke",
  "A misplaced item",
  "A cheerful announcement",
  "A dramatic entrance",
  "A lucky guess",
  "An honest mistake",
  "A helpful stranger",
  "A forgotten appointment",
  "A sudden realization",
  "An accidental reply-all",
  "A cheerful wave",
  "A clumsy moment",
  "A surprise success"
)

function Get-RandomWhite { $whitePool | Get-Random }

$blackCards = @()
for ($i=0; $i -lt $blackCount; $i++) {
  $t = ($blackTemplates | Get-Random).Replace("{W}", (Get-RandomWhite))
  $blackCards += @{ id=$i+1; text=$t; pick=1 }
}

$whiteCards = @()
for ($i=0; $i -lt $whiteCount; $i++) {
  $base = Get-RandomWhite
  $variant = $base
  if (($i % 7) -eq 0) { $variant = "$base (unexpectedly)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, somehow" }
  elseif (($i % 13) -eq 0) { $variant = "$base at the last minute" }

  $whiteCards += @{ id=1001+$i; text=$variant }
}

$data = @{ blackCards=$blackCards; whiteCards=$whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$Out = Join-Path $PSScriptRoot "cards_clean.json"
[System.IO.File]::WriteAllText($Out, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_clean.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $Out).Length)"
