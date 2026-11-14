// Périmètre géographique du jeu — un seul endroit pour l'ajuster.

/** Boîte englobante de l'Europe retenue pour les villes et les aéroports. */
export const EUROPE_BBOX = {
  latMin: 34,
  latMax: 72,
  lngMin: -26,
  lngMax: 45,
};

/**
 * Codes pays ISO éligibles comme destinations. La Russie est exclue par
 * défaut (destinations peu plausibles en train depuis la France) ;
 * la Turquie est incluse (Istanbul). Ajustable librement.
 */
export const EUROPE_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AD", "AL", "AT", "BA", "BE", "BG", "CH", "CY", "CZ", "DE",
  "DK", "EE", "ES", "FI", "FO", "FR", "GB", "GG", "GI", "GR",
  "HR", "HU", "IE", "IM", "IS", "IT", "JE", "LI", "LT", "LU",
  "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT",
  "RO", "RS", "SE", "SI", "SK", "SM", "TR", "UA", "VA", "XK",
]);

/** La ville appartient-elle à la boîte européenne ? */
export function isInEuropeBBox(lat: number, lng: number): boolean {
  return (
    lat >= EUROPE_BBOX.latMin &&
    lat <= EUROPE_BBOX.latMax &&
    lng >= EUROPE_BBOX.lngMin &&
    lng <= EUROPE_BBOX.lngMax
  );
}
