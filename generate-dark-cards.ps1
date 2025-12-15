# Dark Humor deck generator (morbid, edgy, NON-hateful)
# 100 black + 300 white | pick=1 | UTF-8 NO BOM
# Output: cards_dark.json

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "I shouldnt laugh, but {W} did it.",
  "The funeral got weird after {W}.",
  "This is why we dont joke about {W}.",
  "My therapist wasnt ready for {W}.",
  "It was supposed to be serious until {W}.",
  "The darkest part of the story is {W}.",
  "I knew it was bad when {W} felt relatable.",
  "This is how the conversation died: {W}.",
  "We all agreed never to mention {W} again.",
  "That escalated quickly because of {W}.",
  "Nothing prepares you for {W}.",
  "The awkward silence was caused by {W}.",
  "The joke crossed the line at {W}.",
  "This is why we cant have nice things: {W}.",
  "Everyone laughed, then remembered {W}.",
  "The vibe was ruined by {W}.",
  "Morbid curiosity led to {W}.",
  "The disclaimer should have mentioned {W}.",
  "It stopped being funny after {W}.",
  "I regret asking about {W}."
)

$whitePool = @(
  "Laughing at the wrong moment",
  "An intrusive thought winning",
  "A joke that landed too hard",
  "Trauma bonding immediately",
  "Morbid curiosity",
  "An uncomfortable truth",
  "Poorly timed honesty",
  "A nervous laugh",
  "An inappropriate coping mechanism",
  "That one dark thought",
  "Oversharing in public",
  "A sudden existential crisis",
  "Awkward eye contact",
  "A joke nobody claimed",
  "Regret setting in instantly",
  "An unexpected punchline",
  "A cursed memory",
  "The silence afterward",
  "A coping laugh",
  "Humor as a defense mechanism",
  "A comment taken too far",
  "An accidental confession",
  "A laugh you cant take back",
  "The room going quiet",
  "A morally questionable joke",
  "Too much honesty",
  "A joke that aged badly",
  "Uncomfortable agreement",
  "A shared look of concern",
  "A badly timed chuckle",
  "A nervous apology",
  "That joke everyone remembers",
  "Secondhand embarrassment",
  "A dark spiral",
  "A moment of regret",
  "An inside joke gone public",
  "A thought better left unsaid",
  "An awkward pause",
  "The wrong audience",
  "A humor-based deflection"
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
  if (($i % 7) -eq 0) { $variant = "$base (too soon)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, apparently" }
  elseif (($i % 13) -eq 0) { $variant = "$base and immediate regret" }

  $whiteCards += @{ id=1001+$i; text=$variant }
}

$data = @{ blackCards=$blackCards; whiteCards=$whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$Out = Join-Path $PSScriptRoot "cards_dark.json"
[System.IO.File]::WriteAllText($Out, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_dark.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $Out).Length)"
