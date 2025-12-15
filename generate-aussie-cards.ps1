# Aussie deck generator
# 100 black + 300 white | pick=1 | no blanks | UTF-8 NO BOM
# Output: cards_aussie.json

$ErrorActionPreference = "Stop"

$blackCount = 100
$whiteCount = 300

# Black cards (pick=1, no blanks)
$blackTemplates = @(
  "Only in Australia would {W} be considered normal.",
  "The barbecue was going great until {W}.",
  "Every Aussie argument eventually turns into {W}.",
  "The real reason the cops showed up was {W}.",
  "Nothing says Straya like {W}.",
  "I knew it was cooked when {W} happened.",
  "The family gathering fell apart because of {W}.",
  "That was the moment it went full bogan: {W}.",
  "The pub went quiet after {W}.",
  "This is why Mum said dont mention {W}.",
  "The group chat hasnt recovered from {W}.",
  "It was meant to be a quiet one until {W}.",
  "Thats not illegal, its just {W}.",
  "The neighbour complained about {W}.",
  "The worst road trip moment involved {W}.",
  "This is why we cant have nice things in Australia: {W}.",
  "The only explanation is {W}.",
  "Everyone agreed it was fine until {W}.",
  "The night peaked at {W}.",
  "Somehow, {W} became the solution."
)

# White cards (Aussie slang, culture, everyday chaos)
$whitePool = @(
  "A bloke named Damo",
  "A servo meat pie",
  "Calling everyone mate, even the dog",
  "A Bunnings snag",
  "Saying yeah nah",
  "A dodgy backyard setup",
  "Thongs in inappropriate places",
  "A four hour trip to Bunnings",
  "Someone bringing their own Esky",
  "A last minute Maccas run",
  "An unlicensed trailer",
  "A sunburn that hurts to blink",
  "A tradie starting at 6am",
  "A ute doing something illegal",
  "Arguing about footy codes",
  "Warm beer, somehow",
  "A magpie with personal beef",
  "Forgetting sunscreen again",
  "A backyard cricket injury",
  "A pub story that gets worse each time",
  "A Bali tattoo regret",
  "A suspiciously cheap gumtree deal",
  "A road rage thumbs up",
  "A mozzie bite you cant ignore",
  "A half finished reno",
  "Someone yelling OI",
  "A late Centrelink payment",
  "An eshay sighting",
  "A busted Hills Hoist",
  "A loud Kookaburra at 5am",
  "A council fine you deserved",
  "A neighbour with power tools",
  "A sausage sizzle argument",
  "A backyard bonfire",
  "A slippery dip made from tarp",
  "A dodgy accent attempt",
  "A ute tray full of nonsense",
  "A meat raffle obsession",
  "A barefoot trip to the shops",
  "A phrase you cant repeat in front of Nan",
  "An Australia Day debate",
  "A fly that wont leave you alone",
  "A completely cooked idea",
  "A suspiciously confident bloke",
  "A tradie ghosting the job",
  "A group chat called The Lads",
  "A case of beers as currency",
  "A holiday that ended early",
  "A questionable mullet",
  "A stubby holder collection",
  "A loud yeah the boys",
  "A mate who wont shout back",
  "A pie thats lava inside",
  "A barefoot pub visit",
  "A camping trip gone wrong",
  "A ute bogged at the beach",
  "A snake sighting panic",
  "A flyscreen thats never fixed",
  "A text that just says oi",
  "A caravan reversing disaster",
  "A servo bathroom mistake",
  "A power outage at the worst time",
  "A loud phone call on speaker",
  "A questionable nickname",
  "A slap on the back too hard",
  "A hungover Bunnings trip",
  "A comment starting with Im not racist but",
  "A country town rumour",
  "A confused backpacker",
  "A schooner debate",
  "A parma vs parmi argument",
  "A footy tipping meltdown",
  "A weather change in 10 minutes",
  "A mozzie coil indoors",
  "A dad joke that lands",
  "A mate who knows a guy",
  "A cracked thongs emergency",
  "A flat tyre in the middle of nowhere",
  "A pub quiz rivalry",
  "A mystery smell",
  "A backhanded compliment",
  "A fire alarm caused by toast",
  "A parking fine at the beach",
  "A drunk karaoke choice",
  "A group decision that failed",
  "A bold lie at the pub",
  "A neighbour borrowing something forever",
  "A loud conversation about nothing",
  "A meat pie judged harshly"
)

function Get-RandomWhite { $whitePool | Get-Random }

# Build black cards
$blackCards = @()
for ($i = 0; $i -lt $blackCount; $i++) {
  $t = ($blackTemplates | Get-Random).Replace("{W}", (Get-RandomWhite))
  $blackCards += @{ id = $i + 1; text = $t; pick = 1 }
}

# Build white cards with light variants to reach 300
$whiteCards = @()
for ($i = 0; $i -lt $whiteCount; $i++) {
  $base = Get-RandomWhite
  $variant = $base
  if (($i % 7) -eq 0) { $variant = "$base (somehow)" }
  elseif (($i % 11) -eq 0) { $variant = "$base, allegedly" }
  elseif (($i % 13) -eq 0) { $variant = "$base and no regrets" }

  $whiteCards += @{ id = 1001 + $i; text = $variant }
}

$data = @{ blackCards = $blackCards; whiteCards = $whiteCards }
$json = $data | ConvertTo-Json -Depth 8

$OutPath = Join-Path $PSScriptRoot "cards_aussie.json"
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated cards_aussie.json -> black=$blackCount white=$whiteCount bytes=$((Get-Item $OutPath).Length)"
