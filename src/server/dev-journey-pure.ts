// Construction PURE d'itinéraires aléatoires (DEV_FIXTURE=random, M3).
// Aucun import base de données ici : ce module est testé unitairement tel quel.
//
// Méthodologie de réalisme (comment on sait « quelle compagnie » est utilisée) :
//   - les vols ne relient que des VRAIS aéroports IATA (data/airports/
//     airports.europe.json, ≤ 45 km de la ville) et la compagnie est choisie
//     selon le pays de destination (Air France depuis un hub français, Turkish
//     Airlines vers la Turquie, etc.) ;
//   - les trains sont nommés selon le corridor : TER/Intercités/TGV (SNCF)
//     en France, ICE/Railjet/Eurostar… selon le pays de destination à
//     l'international ;
//   - la dernière ligne urbaine est choisie selon le pays de la destination
//     (pas de « RER C » en Turquie) ;
//   - les longs trajets ferroviaires sont découpés en tronçons via des villes
//     à gare situées le long de la ligne, ce qui nourrit aussi l'indice D.
//
// Zone tirée au sort : 50 % destination en France (100 % train), 50 % Europe
// (vol si la destination a un aéroport, sinon train jusqu'à la gare la plus
// proche puis transport urbain).

import { haversineKm } from "../lib/geo/haversine.ts";
import { majorAirportFor, type AirportPick } from "./routing/flights.ts";
import type { Journey, JourneySegment } from "./routing/types.ts";

// Aéroports IATA : source unique dans routing/flights.ts (§5.2).
export { airportFor, majorAirportFor } from "./routing/flights.ts";
export type { AirportPick } from "./routing/flights.ts";

export interface DevCityPick {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
  hasTrainStation?: boolean;
}

export interface Hub {
  name: string;
  country: string;
  lat: number;
  lng: number;
}

export type Zone = "FR" | "EU";

/** Grands hubs européens (coordonnées approximatives des centres-villes). */
export const HUBS: Hub[] = [
  { name: "Paris", country: "FR", lat: 48.8566, lng: 2.3522 },
  { name: "Lyon", country: "FR", lat: 45.764, lng: 4.8357 },
  { name: "Marseille", country: "FR", lat: 43.2965, lng: 5.3698 },
  { name: "Lille", country: "FR", lat: 50.6292, lng: 3.0573 },
  { name: "Strasbourg", country: "FR", lat: 48.5734, lng: 7.7521 },
  { name: "Bordeaux", country: "FR", lat: 44.8378, lng: -0.5792 },
  { name: "Nantes", country: "FR", lat: 47.2184, lng: -1.5536 },
  { name: "Rennes", country: "FR", lat: 48.1173, lng: -1.6778 },
  { name: "Toulouse", country: "FR", lat: 43.6047, lng: 1.4442 },
  { name: "Montpellier", country: "FR", lat: 43.6108, lng: 3.8767 },
  { name: "Bruxelles", country: "BE", lat: 50.8503, lng: 4.3517 },
  { name: "Amsterdam", country: "NL", lat: 52.3676, lng: 4.9041 },
  { name: "Londres", country: "GB", lat: 51.5074, lng: -0.1278 },
  { name: "Cologne", country: "DE", lat: 50.9375, lng: 6.9603 },
  { name: "Francfort", country: "DE", lat: 50.1109, lng: 8.6821 },
  { name: "Zurich", country: "CH", lat: 47.3769, lng: 8.5417 },
  { name: "Milan", country: "IT", lat: 45.4642, lng: 9.19 },
  { name: "Barcelone", country: "ES", lat: 41.3851, lng: 2.1734 },
];

/** Hubs français : la première étape ferroviaire depuis la France reste en France. */
export const FRENCH_HUBS: Hub[] = HUBS.filter((h) => h.country === "FR");

/** Compagnie aérienne selon le pays de destination (départ d'un hub français). */
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

/** Dernière ligne urbaine selon le pays de la destination. */
const URBAN_LINES_BY_COUNTRY: Record<string, string[]> = {
  FR: ["Métro ligne 4", "RER C", "Tram T3", "Bus 91"],
  AT: ["S-Bahn S7", "U-Bahn U4", "Tram 43", "Bus 13A"],
  DE: ["S-Bahn S1", "U-Bahn U5", "Tram M4", "Bus 100"],
  IT: ["Metro linea B", "Treno regionale", "Tram 2", "Bus 64"],
  ES: ["Cercanías C-1", "Metro L3", "Tram T4", "Bus 24"],
  GB: ["Tube Circle line", "London Overground", "National Rail", "Bus 73"],
  CH: ["Tram 7", "S-Bahn S3", "Bus 31"],
  BE: ["Métro ligne 1", "Tram 39", "Bus 71"],
  NL: ["Tram 25", "Metro M52", "Bus 21"],
  TR: ["Metro M1", "Tram T1", "Metrobüs", "Bus 34"],
  PL: ["Tram 14", "Metro M1", "Bus 175"],
};
const URBAN_LINES_DEFAULT = ["S-Bahn", "U-Bahn", "Tram", "Bus"];

/** Train international selon le pays de destination. */
const INTERNATIONAL_RAIL_BY_COUNTRY: Record<string, { mode: string; carrier: string }> = {
  DE: { mode: "ICE", carrier: "ICE (DB)" },
  AT: { mode: "Railjet", carrier: "Railjet (ÖBB)" },
  CH: { mode: "TGV", carrier: "TGV Lyria" },
  IT: { mode: "Frecciarossa", carrier: "Frecciarossa (Trenitalia)" },
  ES: { mode: "AVE", carrier: "AVE (Renfe)" },
  BE: { mode: "IC", carrier: "IC (SNCB)" },
  NL: { mode: "IC", carrier: "IC (NS)" },
  GB: { mode: "Eurostar", carrier: "Eurostar" },
  PL: { mode: "EIP", carrier: "EIP (PKP Intercity)" },
  CZ: { mode: "EuroCity", carrier: "EuroCity (ČD)" },
  HU: { mode: "EuroCity", carrier: "EuroCity (MÁV)" },
};
const INTERNATIONAL_RAIL_DEFAULT = { mode: "EuroCity", carrier: "EuroCity" };

function frenchRail(km: number): { mode: string; carrier: string; speedKmh: number } {
  if (km < 150) return { mode: "TER", carrier: "TER (SNCF)", speedKmh: 60 };
  if (km < 450) return { mode: "Intercités", carrier: "Intercités (SNCF)", speedKmh: 90 };
  return { mode: "TGV", carrier: "TGV inOui (SNCF)", speedKmh: 180 };
}

function internationalRail(country: string): { mode: string; carrier: string; speedKmh: number } {
  const r = INTERNATIONAL_RAIL_BY_COUNTRY[country] ?? INTERNATIONAL_RAIL_DEFAULT;
  return { ...r, speedKmh: 160 };
}

function railDurationMin(km: number, speedKmh: number): number {
  return Math.round((km / speedKmh) * 60) + 12;
}

function urbanModeDetail(line: string): string {
  if (/^(Métro|Metro|Tube|U-Bahn)/.test(line)) return "Métro";
  if (/^RER/.test(line)) return "RER";
  if (/^Tram/.test(line)) return "Tram";
  if (/^Bus/.test(line)) return "Bus";
  if (/S-Bahn/.test(line)) return "S-Bahn";
  if (/(Overground|National Rail|Treno|Cercanías|Metrobüs)/.test(line)) {
    return /Metrobüs/.test(line) ? "Bus" : "Train régional";
  }
  return "Transport urbain";
}

/** Ville à gare la plus proche de la destination (pour un terminus ferroviaire). */
export function nearestStationCity(
  dest: DevCityPick,
  pool: DevCityPick[],
  maxKm = 80,
): DevCityPick {
  if (dest.hasTrainStation) return dest;
  let best: DevCityPick | null = null;
  let bestKm = maxKm;
  for (const c of pool) {
    if (!c.hasTrainStation || c.id === dest.id) continue;
    const km = haversineKm(dest.lat, dest.lng, c.lat, c.lng);
    if (km <= bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best ?? dest;
}

/** Distance approximative d'un point à la ligne a→b (échantillonnage). */
function distToSegmentKm(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { km: number; t: number } {
  let bestKm = Infinity;
  let bestT = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const lat = a.lat + (b.lat - a.lat) * t;
    const lng = a.lng + (b.lng - a.lng) * t;
    const km = haversineKm(p.lat, p.lng, lat, lng);
    if (km < bestKm) {
      bestKm = km;
      bestT = t;
    }
  }
  return { km: bestKm, t: bestT };
}

/** Villes à gare le long de la ligne a→b, pour découper un long trajet rail. */
export function waypointsAlong(
  a: DevCityPick,
  b: DevCityPick,
  pool: DevCityPick[],
  rand: () => number,
): DevCityPick[] {
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const hops = Math.min(5, Math.max(1, Math.round(km / 300)));
  if (hops <= 1) return [b];
  const inner = hops - 1;
  const candidates = pool
    .filter(
      (c) =>
        c.hasTrainStation &&
        c.population >= 15000 &&
        c.id !== a.id &&
        c.id !== b.id &&
        c.name !== a.name &&
        c.name !== b.name,
    )
    .map((c) => ({ c, d: distToSegmentKm(c, a, b) }))
    .filter((x) => x.d.km <= 80)
    .sort((x, y) => x.d.t - y.d.t);
  const picked: DevCityPick[] = [];
  const used = new Set<string>();
  for (let k = 1; k <= inner; k++) {
    const targetT = k / hops;
    let best: { c: DevCityPick; d: { km: number; t: number } } | null = null;
    for (const x of candidates) {
      if (used.has(x.c.id)) continue;
      const score = Math.abs(x.d.t - targetT);
      if (!best || score < Math.abs(best.d.t - targetT)) best = x;
    }
    if (best) {
      used.add(best.c.id);
      picked.push(best.c);
    }
  }
  // Tri final le long de la ligne + destination en bout.
  picked.sort((x, y) => distToSegmentKm(x, a, b).t - distToSegmentKm(y, a, b).t);
  void rand;
  return [...picked, b];
}

/** Arrêts intermédiaires d'un tronçon : villes proches du milieu du trajet. */
function stopsNearMidpoint(
  pool: DevCityPick[],
  a: { lat: number; lng: number; name: string },
  b: { lat: number; lng: number; name: string },
  maxKmFromMid: number,
  count: number,
  rand: () => number,
): string[] {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lng + b.lng) / 2;
  const excluded = new Set([a.name, b.name]);
  const candidates = pool.filter(
    (c) =>
      c.population >= 15000 &&
      !excluded.has(c.name) &&
      haversineKm(midLat, midLng, c.lat, c.lng) <= maxKmFromMid,
  );
  // Mélange partiel par tirages aléatoires, puis découpage : jamais de boucle
  // infinie même si le rand est constant ou si count > candidates.
  const shuffled = [...candidates].sort(() => rand() - 0.5);
  return shuffled.slice(0, count).map((c) => c.name);
}

export interface RandomJourneyPick {
  zone: Zone;
  originCityId: string;
  destCityId: string;
  journey: Journey;
}

/**
 * Construction pure d'un journey aléatoire.
 *  - zone FR : rail origine → hub → destination (100 % train) ;
 *  - zone EU : vol hub → aéroport de la destination si elle en a un (75 % des
 *    cas quand c'est possible), sinon train international jusqu'à la gare la
 *    plus proche puis ligne urbaine ; dans les deux cas, les longs tronçons
 *    rail sont découpés via des villes à gare situées le long de la ligne.
 * Tous les segments portent des coordonnées (tracé de fin sur voies réelles).
 */
export function buildRandomJourney(
  origin: DevCityPick,
  dest: DevCityPick,
  hub: Hub,
  pool: DevCityPick[],
  airports: AirportPick[],
  zone: Zone,
  rand: () => number = Math.random,
): RandomJourneyPick {
  const originCoord: [number, number] = [origin.lat, origin.lng];
  const hubCoord: [number, number] = [hub.lat, hub.lng];
  const destCoord: [number, number] = [dest.lat, dest.lng];

  const segments: JourneySegment[] = [];
  let index = 1;
  const push = (s: Omit<JourneySegment, "index">): void => {
    segments.push({ ...s, index: index++ });
  };

  // 1. Rail origine → hub (toujours en France : TER/Intercités/TGV selon la distance).
  const kmOriginHub = haversineKm(origin.lat, origin.lng, hub.lat, hub.lng);
  const first = frenchRail(kmOriginHub);
  push({
    kind: "rail",
    modeDetail: first.mode,
    lineOrCarrier: first.carrier,
    durationMin: railDurationMin(kmOriginHub, first.speedKmh),
    from: origin.name,
    to: hub.name,
    intermediateStops: stopsNearMidpoint(pool, origin, hub, 120, 2, rand),
    fromCoord: originCoord,
    toCoord: hubCoord,
  });

  // 2. Correspondance au hub.
  push({
    kind: "connection",
    modeDetail: "Correspondance",
    lineOrCarrier: "",
    durationMin: 8 + Math.floor(rand() * 8),
    from: hub.name,
    to: hub.name,
    fromCoord: hubCoord,
    toCoord: hubCoord,
  });

  // Émet une chaîne de tronçons rail entre deux points, découpée via des
  // villes à gare situées le long de la ligne. La marque dépend du corridor :
  // SNCF tant que les deux extrémités sont en France, marque du pays
  // d'arrivée dès que le tronçon quitte la France.
  const hubCity: DevCityPick = {
    id: "hub",
    name: hub.name,
    country: hub.country,
    lat: hub.lat,
    lng: hub.lng,
    population: 0,
    hasTrainStation: true,
  };
  const pushRailChain = (
    from: DevCityPick,
    fromCoord: [number, number],
    to: DevCityPick,
    poolForLeg: DevCityPick[],
  ): void => {
    const wps = waypointsAlong(from, to, poolForLeg, rand);
    let prev = { ...from, coord: fromCoord };
    for (const wp of wps) {
      const km = haversineKm(prev.lat, prev.lng, wp.lat, wp.lng);
      const brand =
        prev.country === "FR" && wp.country === "FR"
          ? frenchRail(km)
          : internationalRail(wp.country || to.country);
      push({
        kind: "rail",
        modeDetail: brand.mode,
        lineOrCarrier: brand.carrier,
        durationMin: railDurationMin(km, brand.speedKmh),
        from: prev.name,
        to: wp.name,
        intermediateStops: stopsNearMidpoint(poolForLeg, prev, wp, 100, 2, rand),
        fromCoord: prev.coord,
        toCoord: [wp.lat, wp.lng],
      });
      prev = { ...wp, coord: [wp.lat, wp.lng] };
    }
  };

  if (zone === "FR") {
    // 3. Rail hub → destination, 100 % en France (pool filtré sur la France).
    const poolFR = pool.filter((c) => c.country === "FR");
    pushRailChain(hubCity, hubCoord, dest, poolFR);
  } else {
    const destAirport = majorAirportFor(dest, airports, 45);
    const hubAirport = majorAirportFor({ lat: hub.lat, lng: hub.lng }, airports, 45);
    if (destAirport && hubAirport && rand() < 0.75) {
      // 3a. Enregistrement au hub.
      push({
        kind: "connection",
        modeDetail: "Enregistrement et embarquement",
        lineOrCarrier: "",
        durationMin: 60 + Math.floor(rand() * 30),
        from: hub.name + " (" + hubAirport.iata + ")",
        to: hub.name + " (" + hubAirport.iata + ")",
        fromCoord: [hubAirport.lat, hubAirport.lng],
        toCoord: [hubAirport.lat, hubAirport.lng],
      });
      // 3b. Vol entre VRAIS aéroports ; compagnie selon le pays d'arrivée.
      const kmAir = haversineKm(hub.lat, hub.lng, dest.lat, dest.lng);
      const airline = AIRLINE_BY_COUNTRY[dest.country] ?? "Air France";
      push({
        kind: "air",
        modeDetail: "Avion",
        lineOrCarrier: airline,
        durationMin: Math.round(kmAir / 12) + 20,
        from: hub.name + " (" + hubAirport.iata + ")",
        to: dest.name + " (" + destAirport.iata + ")",
        intermediateStops: stopsNearMidpoint(pool, hub, dest, 150, 1, rand),
        fromCoord: [hubAirport.lat, hubAirport.lng],
        toCoord: [destAirport.lat, destAirport.lng],
      });
      // 3c. Correspondance à l'aéroport d'arrivée.
      push({
        kind: "connection",
        modeDetail: "Correspondance",
        lineOrCarrier: "",
        durationMin: 10 + Math.floor(rand() * 10),
        from: dest.name + " (" + destAirport.iata + ")",
        to: dest.name + " (" + destAirport.iata + ")",
        fromCoord: [destAirport.lat, destAirport.lng],
        toCoord: [destAirport.lat, destAirport.lng],
      });
      // 3d. Ligne urbaine de l'aéroport au centre de la destination.
      const kmAirport = haversineKm(destAirport.lat, destAirport.lng, dest.lat, dest.lng);
      const lines = URBAN_LINES_BY_COUNTRY[dest.country] ?? URBAN_LINES_DEFAULT;
      const urbanLine = lines[Math.floor(rand() * lines.length)] ?? "Bus";
      push({
        kind: "urban",
        modeDetail: urbanModeDetail(urbanLine),
        lineOrCarrier: urbanLine,
        durationMin: Math.round((kmAirport / 25) * 60) + 8,
        from: dest.name + " (" + destAirport.iata + ")",
        to: dest.name,
        fromCoord: [destAirport.lat, destAirport.lng],
        toCoord: destCoord,
      });
    } else {
      // Pas d'aéroport (ou tirage rail) : train jusqu'à la gare la plus
      // proche de la destination, puis ligne urbaine si nécessaire.
      const station = nearestStationCity(dest, pool, 80);
      pushRailChain(hubCity, hubCoord, station, pool);
      if (station.id !== dest.id) {
        push({
          kind: "connection",
          modeDetail: "Correspondance",
          lineOrCarrier: "",
          durationMin: 5 + Math.floor(rand() * 6),
          from: station.name,
          to: station.name,
          fromCoord: [station.lat, station.lng],
          toCoord: [station.lat, station.lng],
        });
        const kmLast = haversineKm(station.lat, station.lng, dest.lat, dest.lng);
        const lines = URBAN_LINES_BY_COUNTRY[dest.country] ?? URBAN_LINES_DEFAULT;
        const urbanLine = lines[Math.floor(rand() * lines.length)] ?? "Bus";
        push({
          kind: "urban",
          modeDetail: urbanModeDetail(urbanLine),
          lineOrCarrier: urbanLine,
          durationMin: Math.round((kmLast / 20) * 60) + 6,
          from: station.name,
          to: dest.name,
          fromCoord: [station.lat, station.lng],
          toCoord: destCoord,
        });
      }
    }
  }

  const totalDurationMin = segments.reduce((sum, s) => sum + s.durationMin, 0);
  return {
    zone,
    originCityId: origin.id,
    destCityId: dest.id,
    journey: { totalDurationMin, segments },
  };
}
