// Fabrique des épingles de propositions pour la carte (M3).
// DOM volontaire : le contenu animé doit vivre dans un élément enfant, car
// MapLibre réserve l'élément racine d'un marker pour son propre transform.
//
// UX : chaque épingle affiche directement sous son numéro la distance de la
// tentative à la destination secrète (« à X km du but », §1.2), pour que le
// joueur voie son erreur sans quitter la carte.

/** « 1234.4 » → « 1 234 » (fr-FR). */
function formatKm(distanceKm: number): string {
  return Math.round(distanceKm).toLocaleString("fr-FR");
}

/** Élément DOM d'une épingle numérotée avec sa distance au but (à envelopper dans un Marker). */
export function createGuessMarker(
  attemptNumber: number,
  correct: boolean,
  distanceKm?: number,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "dm-guess-pin" + (correct ? " correct" : "");

  const num = document.createElement("span");
  num.className = "dm-guess-num";
  num.textContent = String(attemptNumber);
  el.appendChild(num);

  if (!correct && distanceKm !== undefined) {
    const dist = document.createElement("span");
    dist.className = "dm-guess-dist";
    dist.textContent = "à " + formatKm(distanceKm) + " km";
    el.appendChild(dist);
    el.title = "Essai " + String(attemptNumber) + " : à " + formatKm(distanceKm) + " km du but";
  } else {
    el.title = correct ? "Destination trouvée !" : "Essai " + String(attemptNumber);
  }
  return el;
}
