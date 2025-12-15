/*
  deckManager.js
  Guarantees: no repeats until the deck is exhausted.
  Behavior: shuffle -> draw without replacement -> discard used -> reshuffle discard only when draw empty.
*/
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeDeck(cards, label = "deck") {
  let draw = shuffleInPlace([...cards]);
  let discard = [];

  function remaining() { return draw.length; }
  function discarded() { return discard.length; }

  function drawOne() {
    if (draw.length === 0) {
      if (discard.length === 0) throw new Error(`${label}: no cards left to reshuffle`);
      draw = shuffleInPlace(discard);
      discard = [];
    }
    return draw.pop();
  }

  function drawMany(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(drawOne());
    return out;
  }

  function discardOne(card) {
    if (card) discard.push(card);
  }

  function discardMany(cardsArr) {
    for (const c of (cardsArr || [])) discardOne(c);
  }

  function snapshot() {
    return { draw, discard };
  }

  function restore(state) {
    draw = Array.isArray(state?.draw) ? state.draw : [];
    discard = Array.isArray(state?.discard) ? state.discard : [];
  }

  return { drawOne, drawMany, discardOne, discardMany, remaining, discarded, snapshot, restore };
}

module.exports = { makeDeck, shuffleInPlace };
