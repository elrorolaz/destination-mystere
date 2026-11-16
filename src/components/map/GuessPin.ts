// Fabrique des épingles de propositions pour la carte (M3).
// DOM volontaire : le contenu animé doit vivre dans un élément enfant, car
// MapLibre réserve l'élément racine d'un marker pour son propre transform.

/** Élément DOM d'une épingle numérotée (à envelopper dans un Marker). */
export function createGuessMarker(attemptNumber: number, correct: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = "dm-guess-pin" + (correct ? " correct" : "");
  el.textContent = String(attemptNumber);
  el.title = correct ? "Destination trouvée !" : "Essai " + String(attemptNumber);
  return el;
}
