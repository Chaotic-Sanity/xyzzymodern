# Marvel NSFW deck generator
# 100 black + 300 white | pick=1 | no blanks
# Output: cards_marvel_nsfw.json (UTF-8 NO BOM)

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "The Avengers had to call HR because of {W}.",
  "The real reason the mission failed was {W}.",
  "Nobody warned me about {W} on the team.",
  "The suit malfunctioned during {W}.",
  "This is why {W} is not allowed on missions.",
  "The after-party got messy thanks to {W}.",
  "The villain almost won because of {W}.",
  "The group chat is still arguing about {W}.",
  "The worst superpower side effect is {W}.",
  "The city will never forget {W}.",
  "The secret identity was exposed because of {W}.",
  "Tony Stark absolutely regrets {W}.",
  "The real multiverse threat is {W}.",
  "The press conference went downhill after {W}.",
  "Nick Fury has a file on {W}.",
  "The safe word during training was {W}.",
  "The upgrade nobody asked for was {W}.",
  "The most uncomfortable team meeting involved {W}.",
  "This is why the tower banned {W}.",
  "The Avengers broke up briefly over {W}."
)

$whitePool = @(
  "Spider-Man oversharing again",
  "Iron Man's ego with benefits",
  "Thor not understanding human boundaries",
  "Hulk's anger issues in bed",
  "Black Widow weaponizing eye contact",
  "Captain America being aggressively wholesome",
  "Hawkeye feeling left out again",
  "Doctor Strange abusing time for personal reasons",
  "Scarlet Witch rewriting consent",
  "Vision taking everything literally",
  "Ant-Man at the worst possible size",
  "Wasp losing patience completely",
  "Star-Lord thinking its flirting",
  "Gamora judging silently",
  "Drax taking dirty jokes literally",
  "Rocket stealing something intimate",
  "Groot saying it at the wrong time",
  "Loki gaslighting everyone",
  "Thanos with control issues",
  "Deadpool crossing several lines",
  "Wolverine refusing to talk about it",
  "Professor X knowing too much",
  "Magneto being weirdly persuasive",
  "Jean Grey losing control again",
  "Doctor Doom overcompensating",
  "Venom saying we during foreplay",
  "Daredevil hearing everything",
  "Punisher taking it too far",
  "Moon Knight arguing with himself",
  "Ms Marvel learning new words",
  "Shang-Chi impressing unintentionally",
  "A suit with too many attachments",
  "A multiverse version that is worse",
  "A secret identity kink",
  "A training session gone wrong",
  "A mission that felt illegal",
  "A power that should not be used like that",
  "A hero who wont stop talking",
  "A villain with commitment issues",
  "A portal opening at the worst time"
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
  if (($i % 7) -eq 0) { $variant = "$base (somehow)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, allegedly" }
  elseif (($i % 13) -eq 0) { $variant = "$base and no shame" }

  $whiteCards += @{ id=1001+$i; text=$variant }
}

$data = @{ blackCards=$blackCards; whiteCards=$whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$Out = Join-Path $PSScriptRoot "cards_marvel_nsfw.json"
[System.IO.File]::WriteAllText($Out, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_marvel_nsfw.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $Out).Length)"
