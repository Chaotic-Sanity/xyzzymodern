# Horror deck generator (movie characters + tropes)
# 100 black + 300 white | pick=1 | no blanks
# Output: cards_horror.json (UTF-8 NO BOM)

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "The killer revealed themselves and it was {W}.",
  "The final girl survived thanks to {W}.",
  "The last thing you hear before the scream is {W}.",
  "Rule number one: never trust {W}.",
  "The haunted house was fine until {W}.",
  "The possessed doll's secret weapon is {W}.",
  "They said dont go in there, so of course they brought {W}.",
  "The cursed object came with a bonus: {W}.",
  "The reason the lights flickered was {W}.",
  "The police report simply reads: {W}.",
  "The séance went wrong when someone mentioned {W}.",
  "The monster only fears one thing: {W}.",
  "The jump scare was caused by {W}.",
  "The cabin trip ended because of {W}.",
  "It wasnt the basement that was scary, it was {W}.",
  "The exorcist asked for holy water and got {W}.",
  "The book of the dead offered one deal: {W}.",
  "The curse can only be broken by {W}.",
  "The VHS tape warning was just {W}.",
  "The mirror showed {W} behind you."
)

$whitePool = @(
  "Ghostface doing customer service",
  "Michael Myers speed-walking politely",
  "Jason Voorhees at summer camp orientation",
  "Freddy Krueger in a workplace safety video",
  "Chucky with a tiny attitude problem",
  "Pinhead offering a loyalty program",
  "Leatherface revving the chainsaw like a lawn mower",
  "Pennywise doing balloon animals",
  "Candyman being summoned by accident",
  "The Invisible Man bumping into furniture",
  "A zombie who just wants snacks",
  "A vampire with bad breath",
  "A werewolf shedding everywhere",
  "A possessed doll with main character energy",
  "A haunted mirror with opinions",
  "A creepy music box playing perfectly",
  "A cursed videotape from the bargain bin",
  "A spooky basement with fresh paint",
  "A cabin in the woods with no reception",
  "A mannequin that definitely moved",
  "A final girl pep talk",
  "A flashlight with dying batteries",
  "A door that wont stay shut",
  "A shadow that doesnt match you",
  "A whisper from the hallway",
  "A suspicious nursery rhyme",
  "A creaky floorboard betrayal",
  "A cat that knows too much",
  "A painting that changes expression",
  "A phone call from an unknown number",
  "A storm that arrives on schedule",
  "A dramatic closet reveal",
  "A doorway full of darkness",
  "A staircase that goes on forever",
  "A heartbeat sound effect",
  "A cheap motel with history",
  "A creepy lullaby at 3am",
  "A broken radio repeating one message",
  "A doll that blinks once",
  "A therapist who doesnt believe you",
  "A skeptical detective",
  "A medium who regrets everything",
  "A babysitter on a doomed night",
  "A friendly neighbour who isnt",
  "A diary you shouldnt read",
  "A ritual circle drawn badly",
  "A candle that wont stay lit",
  "A knocking from inside the walls",
  "A scream that cuts off early",
  "A board game that plays itself",
  "A creepy attic with a locked trunk",
  "A reflection that waves first",
  "A doll that moves one inch",
  "A scarecrow with fresh boots",
  "A monster under the bed doing taxes",
  "A ghost that loves drama",
  "A poltergeist with poor manners",
  "A haunted hotel front desk",
  "A creepy carnival at night",
  "A survival guide written in crayon",
  "A harmless antique from the op shop",
  "A demon with a flair for theatrics",
  "A possession with terrible timing",
  "A séance interrupted by snacks",
  "A jump scare caused by a bird",
  "A final girl running in heels",
  "A suspicious we are safe now moment",
  "A lets split up decision"
)

function Get-RandomWhite { $whitePool | Get-Random }

$blackCards = @()
for ($i = 0; $i -lt $blackCount; $i++) {
  $t = ($blackTemplates | Get-Random).Replace("{W}", (Get-RandomWhite))
  $blackCards += @{ id = $i + 1; text = $t; pick = 1 }
}

$whiteCards = @()
for ($i = 0; $i -lt $whiteCount; $i++) {
  $base = Get-RandomWhite
  $variant = $base
  if (($i % 7) -eq 0) { $variant = "$base (in the dark)" }
  elseif (($i % 11) -eq 0) { $variant = "$base somehow" }
  elseif (($i % 13) -eq 0) { $variant = "$base with immediate regret" }

  $whiteCards += @{ id = 1001 + $i; text = $variant }
}

$data = @{ blackCards = $blackCards; whiteCards = $whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$OutPath = Join-Path $PSScriptRoot "cards_horror.json"
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_horror.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $OutPath).Length)"
