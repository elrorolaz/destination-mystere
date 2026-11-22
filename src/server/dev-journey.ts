// Tirage aléatoire d'un défi depuis les villes en base (DEV_FIXTURE=random, M3).
// Partie DB de dev-journey : la construction pure vit dans dev-journey-pure.ts
// (testée sans base) ; ce module charge les aéroports réels (OpenFlights) et
// effectue les requêtes + le tirage de la zone (50 % France / 50 % Europe).

import { readFileSync } from "node:fs";
import path from "node:path";
import { haversineKm } from "../lib/geo/haversine.ts";
import { parisDateKey } from "../lib/paris-date.ts";
import { getCitiesCache } from "./cities.ts";
import {
  buildRandomJourney,
  FRENCH_HUBS,
  type AirportPick,
  type RandomJourneyPick,
  type Zone,
} from "./dev-journey-pure.ts";
import { planJourney } from "./routing/planner.ts";
import { defaultRouter } from "./routing/router.ts";
import { resolveEndpoint } from "./routing/transitous.ts";
import { isMajorAirport } from "./routing/flights.ts";

export {
  airportFor,
  majorAirportFor,
  buildRandomJourney,
  FRENCH_HUBS,
  HUBS,
  nearestStationCity,
} from "./dev-journey-pure.ts";
export type {
  AirportPick,
  DevCityPick,
  Hub,
  RandomJourneyPick,
  Zone,
} from "./dev-journey-pure.ts";

/* ---------- Aéroports réels (dataset versionné OpenFlights) ---------- */

let airportsCache: AirportPick[] | null = null;
let majorAirportsCache: AirportPick[] | null = null;

/** Aéroports européens avec code IATA, mis en cache process. */
export function getAirports(): AirportPick[] {
  if (!airportsCache) {
    const raw = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "data", "airports", "airports.europe.json"),
        "utf8",
      ),
    ) as Array<{
      iata?: string;
      name?: string;
      city?: string;
      countryCode?: string;
      lat?: number;
      lng?: number;
      hubPopulation?: number;
      hubCity?: string;
    }>;
    airportsCache = raw
      .filter(
        (
          a,
        ): a is {
          iata: string;
          name: string;
          city: string;
          lat: number;
          lng: number;
          countryCode?: string;
          hubPopulation?: number;
          hubCity?: string;
        } =>
          typeof a.iata === "string" &&
          a.iata.length === 3 &&
          typeof a.name === "string" &&
          typeof a.city === "string" &&
          typeof a.lat === "number" &&
          typeof a.lng === "number",
      )
      .map((a) => ({
        iata: a.iata,
        name: a.name,
        city: a.city,
        lat: a.lat,
        lng: a.lng,
        countryCode: a.countryCode,
        hubPopulation: a.hubPopulation,
        hubCity: a.hubCity,
      }));
  }
  return airportsCache;
}

/**
 * Aéroports du jeu : uniquement les aéroports INTERNATIONAUX MAJEURS —
 * isMajorAirport filtre le dataset (large_airport, ou medium_airport dont le
 * hub fait ≥ 150 000 hab.) : jamais un petit aérodrome régional dans un
 * itinéraire. Le hubPopulation est lu du fichier quand il y est annoté,
 * sinon calculé depuis les villes en base (ville ≥ 150 000 hab. à ≤ 45 km).
 */
export async function getMajorAirports(): Promise<AirportPick[]> {
  if (majorAirportsCache) return majorAirportsCache;
  const all = getAirports().filter(isMajorAirport);
  if (all.every((a) => typeof a.hubPopulation === "number")) {
    majorAirportsCache = all;
    return all;
  }
  const cache = await getCitiesCache();
  if (!cache) return all;
  const bigCities = cache.cities.filter((c) => c.population >= 150000);
  majorAirportsCache = all.map((a) => {
    if (typeof a.hubPopulation === "number" && a.hubCity) return a;
    let hubPop = 0;
    let hubName: string | undefined;
    for (const c of bigCities) {
      if (haversineKm(c.lat, c.lng, a.lat, a.lng) <= 45 && c.population > hubPop) {
        hubPop = c.population;
        hubName = c.name;
      }
    }
    return {
      ...a,
      hubPopulation: hubPop > 0 ? hubPop : a.hubPopulation,
      hubCity: hubName ?? a.hubCity,
    };
  });
  return majorAirportsCache;
}

/**
 * Tirage aléatoire d'un défi (DEV_FIXTURE=random) : départ français avec gare,
 * puis zone FR (50 %) ou EU (50 %).
 *
 * L'itinéraire est calculé par le VRAI planner (routeur GTFS + vérification
 * M2) : chaque tirage est donc réaliste et optimal, comme en production.
 * Repli : si le routeur est injoignable (hors-ligne), on retombe sur le
 * générateur synthétique dev-journey-pure.
 */
export async function pickRandomChallenge(
  rand: () => number = Math.random,
): Promise<RandomJourneyPick | null> {
  const cache = await getCitiesCache();
  if (!cache) return null;
  const cities = cache.cities;
  // Design clusters : seules les villes de référence (affichées/cliquables)
  // peuvent être départ ou destination.
  const isRef = (c: (typeof cities)[number]): boolean => cache.clusters.isRef(c.id);
  const origins = cities.filter(
    (c) => c.country === "FR" && c.hasTrainStation && c.population >= 20000 && isRef(c),
  );
  if (origins.length === 0) return null;
  const airports = await getMajorAirports();
  // 40 % d'itinéraires sans avion (comme en production, NO_AIR_PROBABILITY).
  const noAir = rand() < 0.4;
  const zone: Zone = noAir ? (rand() < 0.5 ? "FR" : "EU") : "EU";
  const allowAir = zone === "EU" && !noAir;
  const dests =
    zone === "FR"
      ? cities.filter((c) => c.country === "FR" && c.hasTrainStation && c.population >= 30000 && isRef(c))
      : cities.filter((c) => c.country !== "FR" && c.population >= 50000 && isRef(c));
  if (dests.length === 0) return null;

  // 1) Vrai planner (routeur réel + vérification) sur des paires aléatoires.
  const router = defaultRouter();
  const dateKey = parisDateKey();
  for (let attempt = 0; attempt < 14; attempt++) {
    const origin = origins[Math.floor(rand() * origins.length)]!;
    const dest = dests[Math.floor(rand() * dests.length)]!;
    if (dest.id === origin.id || dest.name === origin.name) continue;
    const kmOD = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    if (zone === "FR" && kmOD < 80) continue;
    if (zone === "EU" && kmOD < (allowAir ? 600 : 250)) continue;
    try {
      const originEp = { ...(await resolveEndpoint(router, origin, true)), country: origin.country };
      const destEp = { ...(await resolveEndpoint(router, dest, dest.hasTrainStation)), country: dest.country };
      const planned = await planJourney(originEp, destEp, { router, airports, dateKey, allowAir });
      if (!planned.verified.ok) continue;
      return {
        zone,
        originCityId: origin.id,
        destCityId: dest.id,
        journey: planned.journey,
      };
    } catch {
      continue; // paire sans itinéraire : on en tire une autre
    }
  }

  // 2) Repli hors-ligne : générateur synthétique (dev-journey-pure).
  for (let attempt = 0; attempt < 40; attempt++) {
    const origin = origins[Math.floor(rand() * origins.length)];
    const dest = dests[Math.floor(rand() * dests.length)];
    const hub = FRENCH_HUBS[Math.floor(rand() * FRENCH_HUBS.length)];
    if (!origin || !dest || !hub) continue;
    if (dest.id === origin.id || dest.name === origin.name) continue;
    if (dest.name === hub.name) continue;
    const kmOriginHub = haversineKm(origin.lat, origin.lng, hub.lat, hub.lng);
    const kmHubDest = haversineKm(hub.lat, hub.lng, dest.lat, dest.lng);
    if (kmOriginHub < 60) continue; // hub trop proche du départ
    if (zone === "FR") {
      if (kmHubDest < 60) continue;
      if (haversineKm(origin.lat, origin.lng, dest.lat, dest.lng) < 80) continue;
    } else if (kmHubDest < 250) {
      continue; // trajet européen trop court pour être intéressant
    }
    // Sans avion (40 % des tirages) : repli synthétique 100 % terrestre.
    return buildRandomJourney(origin, dest, hub, cities, allowAir ? airports : [], zone, rand);
  }
  // Repli : on relâche les contraintes de distance.
  const origin = origins[Math.floor(rand() * origins.length)];
  const dest = dests[Math.floor(rand() * dests.length)];
  const hub = FRENCH_HUBS[Math.floor(rand() * FRENCH_HUBS.length)];
  if (!origin || !dest || !hub || dest.id === origin.id) return null;
  return buildRandomJourney(origin, dest, hub, cities, allowAir ? airports : [], zone, rand);
}
