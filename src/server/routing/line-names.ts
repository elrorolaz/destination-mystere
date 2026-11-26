// Normalisation des NOMS DE LIGNES (indice C) — un seul endroit à maintenir.
//
// Corrections demandées :
//   - « EST » (Eurostar) → **Eurostar** (ex. « EST 9050 » → « Eurostar ») ;
//   - « IC » (Intercités) → **Intercités** (ex. « IC 1234 » → « Intercités ») ;
//   - ligne de métro « 14 » (ou « M14 ») → **« métro 14 »**.
//
// Le libellé brut vient de MOTIS (routeShortName) ou de Navitia (label /
// commercial_mode) ; `modeDetail` (« Métro », « TER », « RER »…) sert à
// distinguer une ligne de métro d'un simple numéro de bus.

/**
 * Normalise un nom de ligne brut.
 * - « EST » / « EST 9050 » → « Eurostar » ;
 * - « IC » / « IC 1234 » → « Intercités » ;
 * - « 14 » / « M14 » avec modeDetail « Métro » → « métro 14 » ;
 * - tout le reste est renvoyé tel quel (tronçonné, sans le n° de course).
 */
export function normalizeLineLabel(raw: string, modeDetail = ""): string {
  const base = raw.trim();
  if (/^EST(\s+\d+)?$/i.test(base)) return "Eurostar";
  if (/^IC(\s+\d+)?$/i.test(base)) return "Intercités";
  if (modeDetail === "Métro") {
    const m = base.match(/^(?:M\s?)?(\d+)$/i);
    if (m) return "métro " + m[1];
  }
  return base;
}
