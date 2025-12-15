# DC NSFW deck generator
# 100 black + 300 white | pick=1 | no blanks
# Output: cards_dc_nsfw.json (UTF-8 NO BOM)

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

$blackTemplates = @(
  "The Justice League emergency meeting was about {W}.",
  "Batman refuses to talk about {W}.",
  "The real reason Gotham is cursed is {W}.",
  "The mission debrief was awkward because of {W}.",
  "Alfred has definitely seen {W} before.",
  "The Watchtower banned {W}.",
  "This is why superheroes need boundaries: {W}.",
  "The villain almost won thanks to {W}.",
  "The sidekick therapy session mentioned {W}.",
  "The city will need counseling after {W}.",
  "The Batcave has rules about {W}.",
  "The lasso of truth revealed {W}.",
  "The speed force should not be used for {W}.",
  "The cape made things worse during {W}.",
  "The public apology was for {W}.",
  "The press found out about {W}.",
  "The team split briefly over {W}.",
  "The multiverse version was into {W}.",
  "The most uncomfortable silence involved {W}.",
  "This is why Gotham has trust issues: {W}."
)

$whitePool = @(
  "Batman brooding shirtless",
  "Superman pretending not to notice",
  "Wonder Woman making intense eye contact",
  "The Flash finishing too fast",
  "Aquaman being unnecessarily confident",
  "Cyborg upgrading something personal",
  "Green Lantern imagining the wrong thing",
  "Shazam forgetting he is an adult",
  "Martian Manhunter judging quietly",
  "Alfred walking in at the wrong moment",
  "Joker making it weird",
  "Harley Quinn oversharing",
  "Catwoman stealing something intimate",
  "Lex Luthor compensating hard",
  "Darkseid demanding obedience",
  "Deathstroke charging extra",
  "Bane explaining dominance",
  "Riddler asking too many questions",
  "Two-Face flipping for consent",
  "Penguin waddling confidently",
  "Poison Ivy crossing boundaries",
  "Scarecrow enjoying fear a bit too much",
  "Black Adam refusing to apologize",
  "A Bat-Signal interruption",
  "A cape malfunction",
  "A sidekick learning too much",
  "A secret identity accident",
  "A villain with commitment issues",
  "A Justice League group chat leak",
  "A Gotham rooftop misunderstanding",
  "A speed force miscalculation",
  "A lasso of truth moment",
  "A mother box buzzing",
  "A multiverse double",
  "A costume that rides up",
  "A dramatic reveal gone wrong",
  "A hero who wont stop talking",
  "A villain with a safe word",
  "A very public mistake",
  "A suspiciously long stare"
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
  if (($i % 7) -eq 0) { $variant = "$base (awkwardly)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, allegedly" }
  elseif (($i % 13) -eq 0) { $variant = "$base and no one talked about it again" }

  $whiteCards += @{ id=1001+$i; text=$variant }
}

$data = @{ blackCards=$blackCards; whiteCards=$whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$Out = Join-Path $PSScriptRoot "cards_dc_nsfw.json"
[System.IO.File]::WriteAllText($Out, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_dc_nsfw.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $Out).Length)"
