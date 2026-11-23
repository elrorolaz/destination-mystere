// Planner d'itinéraires (M2, spécification §6.3) — version « réels ».
//
//   - candidat A : porte-à-porte 100 % transports en commun, calculé par le
//     ROUTEUR (Transitous/MOTIS par défaut : vrais horaires GTFS, aucune clé) ;
//   - candidat B : DÉPART → AÉROPORT A → (vol A→B) → AÉROPORT B → ARRIVÉE,
//     où A et B sont les aéroports INTERNATIONAUX les plus proches de chaque
//     extrémité (dataset filtré large_airport) ; les deux tronçons au sol
//     sont calculés par le même routeur puis concaténés avec le vol ;
//   - le plus « optimal » gagne (durée + pénalité de correspondance) ;
//   - le journey retenu est VÉRIFIÉ (verify.ts : existence réelle de chaque
//     leg à son horaire + arrêts intermédiaires + optimalité) avant d'être
//     proposé au jeu.
//
// Un trajet France → France reste 100 % ferroviaire (jamais d'avion interne) :
// le candidat avion n'est construit que si les deux pays diffèrent.
//
// Plus d'estimation paramétrique fantaisiste : si le routeur ne renvoie rien,
// on lève une erreur et la génération quotidienne réessaie une autre paire
// (puis retombe sur le fixture, §6.5).

import { haversineKm } from "../../lib/geo/haversine.ts";
import { parisDateKey } from "../../lib/paris-date.ts";
import {
  airlineForCountry,
  airportCityLabel,
  majorAirportFor,
  estimateFlightDurationMin,
  type AirportPick,
} from "./flights.ts";
import { defaultRouter, type Router, type TransitEndpoint } from "./router.ts";
import {
  itineraryScore,
  itineraryToSegments,
  parisTimeIso,
  selectItinerary,
  type RouterItinerary,
  type RouterLeg,
} from "./transitous.ts";
import { verifyJourney, type VerificationReport } from "./verify.ts";
import { mergeEdgeConnections } from "./cleanup.ts";
import type { Journey } from "./types.ts";

export interface PlanOptions {
  router?: Router;
  airports?: readonly AirportPick[];
  dateKey?: string;
  /** Instant ISO de départ (défaut : 08:00 Europe/Paris le jour du défi). */
  timeIso?: string;
  numItineraries?: number;
  /** Distance min origine→destination pour envisager l'avion (km). */
  minAirKm?: number;
  /** Distance de vol min entre les deux aéroports retenus (km). */
  minFlightKm?: number;
  /** Portée max de recherche de l'aéroport majeur de départ (km). */
  originAirportKm?: number;
  /** Portée max de recherche de l'aéroport majeur d'arrivée (km). */
  destAirportKm?: number;
  /** false = itinéraire 100 % terrestre : le candidat avion n'est pas construit. */
  allowAir?: boolean;
  /** Désactive la vérification (tests). */
  verify?: boolean;
}

export interface PlannedJourney {
  journey: Journey;
  source: string;
  candidates: number;
  verified: VerificationReport;
}

function connectionLeg(name: string, coord: [number, number], durationMin: number, label: string): RouterLeg {
  return {
    mode: "WALK",
    kind: "connection",
    modeDetail: label,
    lineOrCarrier: "",
    from: name,
    to: name,
    fromCoord: coord,
    toCoord: coord,
    durationMin,
    startTime: "",
    endTime: "",
    intermediateStops: [],
  };
}

/** Accès aéroport absurde (garde-fou) : > 4 h ou plus de 3 tronçons de transport. */
function absurdAccess(it: RouterItinerary | null): boolean {
  return (
    !it ||
    it.durationMin > 240 ||
    it.legs.filter((l) => l.kind !== "connection").length > 3
  );
}

/**
 * Candidats de point de planification pour un aéroport : d'abord son ARRÊT
 * (STOP géocodé par nom — les coordonnées brutes de la piste peuvent être hors
 * du rayon de snap du routeur), puis la gare de sa ville-hub (repli réaliste
 * quand l'aérogare elle-même ne route pas bien, ex. Bari → Barletta en bus).
 */
async function airportEndpointCandidates(
  router: Router & { geocode?: (text: string, preferStop?: boolean) => Promise<TransitEndpoint | null> },
  a: AirportPick,
): Promise<TransitEndpoint[]> {
  const out: TransitEndpoint[] = [];
  if (router.geocode) {
    const stop = await router.geocode(a.name, true);
    if (stop) out.push({ ...stop, country: a.countryCode });
    const hub = await router.geocode(a.hubCity || a.city, true);
    if (hub && !out.some((o) => o.lat === hub.lat && o.lng === hub.lng)) {
      out.push({ ...hub, country: a.countryCode });
    }
  }
  if (out.length === 0) {
    out.push({ name: a.name, lat: a.lat, lng: a.lng, country: a.countryCode });
  }
  return out;
}

/**
 * Tronçons au sol ORIGINE → AÉROPORT A (méthode de calcul d'itinéraire
 * appliquée une 1ʳᵉ fois). Termine à l'aérogare (navette estimée si le
 * routeur s'est arrêté à la gare de la ville-hub).
 */
async function accessToAirport(
  router: Router & { geocode?: (text: string, preferStop?: boolean) => Promise<TransitEndpoint | null> },
  origin: TransitEndpoint,
  airport: AirportPick,
  timeIso: string,
): Promise<RouterLeg[] | null> {
  const label = airportCityLabel(airport) + " (" + airport.iata + ")";
  const coord: [number, number] = [airport.lat, airport.lng];
  for (const ep of await airportEndpointCandidates(router, airport)) {
    const best = selectItinerary(await router.plan(origin, ep, timeIso, 5));
    if (best && !absurdAccess(best)) {
      const legs = [...best.legs];
      const endPt = lastPointOf(best);
      const gap = haversineKm(endPt.coord[0], endPt.coord[1], coord[0], coord[1]);
      if (gap > 3) legs.push(shuttleLeg(endPt.name, endPt.coord, label, coord, gap));
      return legs;
    }
  }
  return null;
}

/**
 * Tronçons au sol AÉROPORT B → ARRIVÉE (méthode de calcul appliquée une
 * 2ᵉ fois). Démarre à l'aérogare (navette estimée si nécessaire).
 */
async function accessFromAirport(
  router: Router & { geocode?: (text: string, preferStop?: boolean) => Promise<TransitEndpoint | null> },
  airport: AirportPick,
  dest: TransitEndpoint,
  timeIso: string,
): Promise<RouterLeg[] | null> {
  const label = airportCityLabel(airport) + " (" + airport.iata + ")";
  const coord: [number, number] = [airport.lat, airport.lng];
  for (const ep of await airportEndpointCandidates(router, airport)) {
    const best = selectItinerary(await router.plan(ep, dest, timeIso, 5));
    if (best && !absurdAccess(best)) {
      const legs = [...best.legs];
      const startPt = firstPointOf(best);
      const gap = haversineKm(coord[0], coord[1], startPt.coord[0], startPt.coord[1]);
      if (gap > 3) legs.unshift(shuttleLeg(label, coord, startPt.name, startPt.coord, gap));
      return legs;
    }
  }
  return null;
}

/**
 * Navette aéroport estimée (bus) quand le routeur ne dessert pas l'arrêt
 * d'aéroport lui-même : il s'arrête à la gare de la ville (ex. Nantes gare)
 * et il faut encore rejoindre la aérogare (ex. Tan'Air vers NTE). Leg « urban »
 * honnête : le vol lui-même est estimé (§5.2), l'accès est au mieux réel.
 */
function shuttleLeg(
  fromName: string,
  fromCoord: [number, number],
  toName: string,
  toCoord: [number, number],
  km: number,
): RouterLeg {
  return {
    mode: "BUS",
    kind: "urban",
    modeDetail: "Bus",
    lineOrCarrier: "Navette aéroport",
    from: fromName,
    to: toName,
    fromCoord,
    toCoord,
    durationMin: Math.max(5, Math.round((km / 30) * 60) + 5),
    startTime: "",
    endTime: "",
    intermediateStops: [],
    estimated: true, // pas rejouable tel quel contre le GTFS (vérification : chaîne seulement)
  };
}

/** Dernier point RÉEL atteint par un itinéraire (en ignorant les pseudo-lieux END). */
function lastPointOf(it: RouterItinerary): { name: string; coord: [number, number] } {
  for (let i = it.legs.length - 1; i >= 0; i--) {
    const l = it.legs[i]!;
    if (l.to && l.to !== "END") return { name: l.to, coord: l.toCoord };
  }
  const last = it.legs[it.legs.length - 1];
  return { name: last?.to ?? "", coord: last?.toCoord ?? [0, 0] };
}

/** Premier point RÉEL d'un itinéraire (en ignorant les pseudo-lieux START). */
function firstPointOf(it: RouterItinerary): { name: string; coord: [number, number] } {
  for (let i = 0; i < it.legs.length; i++) {
    const l = it.legs[i]!;
    if (l.from && l.from !== "START") return { name: l.from, coord: l.fromCoord };
  }
  const first = it.legs[0];
  return { name: first?.from ?? "", coord: first?.fromCoord ?? [0, 0] };
}

function airLeg(
  flight: { from: string; to: string; fromCoord: [number, number]; toCoord: [number, number]; durationMin: number },
  carrier: string,
): RouterLeg {
  return {
    mode: "AIR",
    kind: "air",
    modeDetail: "Avion",
    lineOrCarrier: carrier,
    from: flight.from,
    to: flight.to,
    fromCoord: flight.fromCoord,
    toCoord: flight.toCoord,
    durationMin: flight.durationMin,
    startTime: "",
    endTime: "",
    intermediateStops: [],
  };
}

/**
 * Planifie et vérifie l'itinéraire entre deux villes.
 * Lance une erreur si aucun itinéraire réaliste n'existe (le routeur est la
 * seule source de vérité ; pas de génération synthétique ici).
 */
export async function planJourney(
  origin: TransitEndpoint,
  dest: TransitEndpoint,
  opts: PlanOptions = {},
): Promise<PlannedJourney> {
  const router = opts.router ?? defaultRouter();
  const dateKey = opts.dateKey ?? parisDateKey();
  const timeIso = opts.timeIso ?? parisTimeIso(dateKey, "08:00");
  const airports = opts.airports ?? [];
  const minAirKm = opts.minAirKm ?? 450;
  const minFlightKm = opts.minFlightKm ?? 400;
  const originAirportKm = opts.originAirportKm ?? 200;
  const destAirportKm = opts.destAirportKm ?? 300;
  const numItineraries = opts.numItineraries ?? 8;
  const allowAir = opts.allowAir ?? true;

  // --- Candidat A : direct porte-à-porte (réel, GTFS).
  const direct = await router.plan(origin, dest, timeIso, numItineraries);
  let best: RouterItinerary | null = selectItinerary(direct);
  let candidates = direct.length;

  // --- Candidat B : départ → aéroport A → vol A→B → aéroport B → arrivée.
  // A = aéroport international MAJEUR le plus proche du DÉPART, B = le plus
  // proche de l'ARRIVÉE (jamais un petit aérodrome régional). Les tronçons au
  // sol sont planifiés par le routeur (GTFS) puis concaténés : la méthode de
  // calcul d'itinéraire est appliquée deux fois, une par accès aéroport.
  // Jamais de vol France → France.
  const km = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
  const sameCountry = Boolean(origin.country && dest.country && origin.country === dest.country);
  if (allowAir && km >= minAirKm && !sameCountry && airports.length > 0) {
    const fromA = majorAirportFor(origin, airports, originAirportKm);
    const toA = majorAirportFor(dest, airports, destAirportKm);
    if (fromA && toA && fromA.iata !== toA.iata) {
      const flightKm = haversineKm(fromA.lat, fromA.lng, toA.lat, toA.lng);
      if (flightKm >= minFlightKm) {
        // Accès aéroports : la méthode de calcul d'itinéraire est appliquée
        // DEUX FOIS — origine → aérogare A, puis aérogare B → arrivée.
        const [outLegs, inLegs] = await Promise.all([
          accessToAirport(router, origin, fromA, timeIso),
          accessFromAirport(router, toA, dest, timeIso),
        ]);
        if (outLegs && inLegs) {
          const flight = {
            from: airportCityLabel(fromA) + " (" + fromA.iata + ")",
            to: airportCityLabel(toA) + " (" + toA.iata + ")",
            fromCoord: [fromA.lat, fromA.lng] as [number, number],
            toCoord: [toA.lat, toA.lng] as [number, number],
            durationMin: estimateFlightDurationMin(flightKm),
          };
          const legs: RouterLeg[] = [
            ...outLegs,
            connectionLeg(flight.from, flight.fromCoord, 60, "Enregistrement et embarquement"),
            airLeg(flight, airlineForCountry(dest.country ?? toA.countryCode)),
            connectionLeg(flight.to, flight.toCoord, 15, "Correspondance"),
            ...inLegs,
          ];
          candidates += 2;
          const airItin: RouterItinerary = {
            durationMin: legs.reduce((a, l) => a + l.durationMin, 0),
            transfers:
              outLegs.filter((l) => l.kind === "connection").length +
              inLegs.filter((l) => l.kind === "connection").length +
              1,
            startTime: outLegs[0]?.startTime ?? timeIso,
            endTime: inLegs[inLegs.length - 1]?.endTime ?? timeIso,
            legs,
          };
          if (!best || itineraryScore(airItin) < itineraryScore(best)) {
            best = airItin;
          }
        }
      }
    }
  }

  if (!best) {
    throw new Error(
      "planner : aucun itinéraire réaliste " + origin.name + " → " + dest.name + " (routeur " + router.name + ")",
    );
  }

  const rawSegments = itineraryToSegments(best);
  const journey: Journey = {
    totalDurationMin: rawSegments.reduce((a, s) => a + s.durationMin, 0),
    segments: rawSegments,
  };
  const verified: VerificationReport =
    opts.verify === false
      ? { ok: true, reasons: [] }
      : await verifyJourney(journey, { origin, dest }, router, timeIso, airports);

  // Nettoyage APRÈS vérification (la vérif rejoue chaque leg tel quel, les
  // correspondances de bordure comprises) : les legs à pied de 1–2 min en
  // début/fin (START → gare, gare → END) sont fondus dans le premier/dernier
  // tronçon de transport — le trajet affiché reste portes-à-portes.
  journey.segments = mergeEdgeConnections(rawSegments);

  return { journey, source: router.name, candidates, verified };
}
