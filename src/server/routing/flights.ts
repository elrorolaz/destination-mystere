// Estimation des vols SANS API payante (spécification §5.2 : Amadeus Self-Service
// a fermé aux nouveaux comptes le 17/07/2026 — ne pas bâtir dessus).
//
// Méthode v1 : aéroport IATA le plus proche de chaque extrémité (base
// OpenFlights, data/airports/airports.europe.json), durée de vol estimée =
// distance orthodromique ÷ 800 km/h + 35 min de marge (taxi, embarquement).
// Les tronçons d'accès aux aéroports sont calculés par le planner (API SNCF
// ou estimation paramétrique).

import { haversineKm } from "../../lib/geo/haversine.ts";

export interface AirportPick {
  iata: string;
  name: string;
  /** Ville desservie par l'aéroport (utilisée pour nommer le leg avion). */
  city: string;
  lat: number;
  lng: number;
  /** Code pays ISO 2 lettres de l'aéroport (compagnie aérienne). */
  countryCode?: string;
  /** Population de la plus grande ville à ≤ 45 km (0 si inconnu) : « majeur ». */
  hubPopulation?: number;
  /** Nom de la ville-hub (plus grande ville à ≤ 45 km) : « Lyon » pour LYS. */
  hubCity?: string;
}

/** Nom de ville affiché pour un aéroport : la ville-hub plutôt que la commune. */
export function airportCityLabel(a: AirportPick): string {
  return a.hubCity || a.city;
}

/**
 * Compagnie aérienne la plus vraisemblable selon le pays de destination
 * (hub du pavillon national). Le jeu n'appelle pas d'API de vols : la compagnie
 * affichée est indicative, le vol lui-même est validé par les codes IATA.
 */
const AIRLINE_BY_COUNTRY: Record<string, string> = {
  FR: "Air France",
  DE: "Lufthansa",
  AT: "Austrian Airlines",
  CH: "Swiss",
  IT: "ITA Airways",
  ES: "Iberia",
  GB: "British Airways",
  NL: "KLM",
  BE: "Brussels Airlines",
  TR: "Turkish Airlines",
  PT: "TAP Air Portugal",
  IE: "Ryanair",
  PL: "LOT Polish Airlines",
  GR: "Aegean Airlines",
  DK: "SAS",
  SE: "SAS",
  NO: "SAS",
  FI: "Finnair",
  CZ: "Smartwings",
  HU: "Wizz Air",
  RO: "TAROM",
  IS: "Icelandair",
  LU: "Luxair",
};

/** Compagnie selon le pays ISO de la destination (défaut : Air France). */
export function airlineForCountry(countryCode: string | undefined): string {
  if (!countryCode) return "Avion";
  return AIRLINE_BY_COUNTRY[countryCode.toUpperCase()] ?? "Air France";
}

/** Vitesse de croisière retenue pour l'estimation (§5.2). */
export const CRUISE_SPEED_KMH = 800;
/** Marge taxi/embarquement/débarquement (§5.2). */
export const FLIGHT_OVERHEAD_MIN = 35;

/**
 * Aéroport INTERNATIONAL le plus proche d'une ville (≤ maxKm). Le dataset
 * data/airports/airports.europe.json ne contient plus que des aéroports
 * internationaux (large_airport OpenFlights), donc « le plus proche » est
 * bien « l'international le plus proche ».
 */
export function airportFor(
  city: { lat: number; lng: number },
  airports: readonly AirportPick[],
  maxKm = 45,
): AirportPick | null {
  let best: AirportPick | null = null;
  let bestKm = maxKm;
  for (const a of airports) {
    const km = haversineKm(city.lat, city.lng, a.lat, a.lng);
    if (km <= bestKm) {
      bestKm = km;
      best = a;
    }
  }
  return best;
}

/** Alias explicite : aéroport international le plus proche (dataset filtré). */
export const internationalAirportFor = airportFor;

/**
 * Aéroport « majeur » (§5.2) le plus proche : parmi les aéroports à ≤ maxKm,
 * celui qui dessert la plus grande ville (hubPopulation, ville à ≤ 45 km de
 * ≥ 150 000 hab.) ; à hub égal, le plus proche. Sans hubPopulation renseigné,
 * retombe sur le plus proche.
 */
export function majorAirportFor(
  city: { lat: number; lng: number },
  airports: readonly AirportPick[],
  maxKm = 45,
): AirportPick | null {
  let best: AirportPick | null = null;
  let bestPop = -1;
  let bestKm = Infinity;
  for (const a of airports) {
    const km = haversineKm(city.lat, city.lng, a.lat, a.lng);
    if (km > maxKm) continue;
    const pop = a.hubPopulation ?? 0;
    if (pop > bestPop || (pop === bestPop && km < bestKm)) {
      best = a;
      bestPop = pop;
      bestKm = km;
    }
  }
  return best;
}

export interface FlightEstimate {
  from: string; // « Paris (CDG) »
  to: string; // « Vienne (VIE) »
  fromCoord: [number, number];
  toCoord: [number, number];
  distanceKm: number;
  durationMin: number;
}

/** Durée de vol estimée entre deux aéroports (§5.2). */
export function estimateFlightDurationMin(distanceKm: number): number {
  return Math.round((distanceKm / CRUISE_SPEED_KMH) * 60) + FLIGHT_OVERHEAD_MIN;
}

/** Estimation d'un vol entre les aéroports les plus proches de deux villes. */
export function estimateFlight(
  origin: { name: string; lat: number; lng: number },
  dest: { name: string; lat: number; lng: number },
  airports: readonly AirportPick[],
  originMaxKm = 150,
  destMaxKm = 45,
): FlightEstimate | null {
  const from = majorAirportFor(origin, airports, originMaxKm);
  const to = majorAirportFor(dest, airports, destMaxKm);
  if (!from || !to || from.iata === to.iata) return null;
  const distanceKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return {
    // Nommé d'après la VILLE DESSERVIE par l'aéroport (hub), pas la ville de
    // départ : « Lyon (LYS) », pas « Villeurbanne (LYS) » ni « Colombier-Saugnieu (LYS) ».
    from: airportCityLabel(from) + " (" + from.iata + ")",
    to: airportCityLabel(to) + " (" + to.iata + ")",
    fromCoord: [from.lat, from.lng],
    toCoord: [to.lat, to.lng],
    distanceKm: Math.round(distanceKm),
    durationMin: estimateFlightDurationMin(distanceKm),
  };
}
