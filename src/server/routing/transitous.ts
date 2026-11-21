// Client Transitous (MOTIS) — planification d'itinéraires RÉELS sans clé API.
//
//   https://api.transitous.org  (projet ouvert, données GTFS Europe + OSM)
//   GET /api/v1/plan?fromPlace=lat,lon&toPlace=lat,lon&time=ISO&numItineraries=N
//
// Les itinéraires proposés sont de VRAIS horaires (GTFS) : chaque leg porte
// son mode, sa ligne (routeShortName), sa compagnie (agencyName), ses arrêts
// intermédiaires et ses coordonnées — ce qui rend l'itinéraire vérifiable
// (voir verify.ts) et traçable sur les vraies voies (legGeometry disponible).
//
// Critère de choix « optimal » : score = durée + PÉNALTY × correspondances
// (une correspondance coûte ~30 min réels de marche/attente, souvent
// sous-estimés par les durées GTFS). Ex. Rennes → Mantes-la-Jolie :
// TGV + Transilien N (1 correspondance) l'emporte sur métro + ligne J (2).

import { haversineKm } from "../../lib/geo/haversine.ts";
import type { JourneySegment } from "./types.ts";

export const TRANSITOUS_BASE_URL = "https://api.transitous.org";
/** Pénalité par correspondance dans le score de choix (minutes). */
export const TRANSFER_PENALTY_MIN = 30;
const REQUEST_TIMEOUT_MS = 20000;
/** Certains proxys bloquent le fetch Node sans User-Agent navigateur (403). */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface TransitEndpoint {
  name: string;
  lat: number;
  lng: number;
  /** Code pays ISO 2 lettres, ex. "FR" — sert à la logique avion (jamais FR→FR). */
  country?: string;
}

export type LegKind = "rail" | "urban" | "air" | "connection";

export interface RouterLeg {
  mode: string; // mode MOTIS brut (HIGHSPEED_RAIL, SUBWAY, WALK…)
  kind: LegKind;
  modeDetail: string; // TGV, Transilien, Métro…
  lineOrCarrier: string; // « TGV INOUI », « Transilien N »…
  from: string;
  to: string;
  fromCoord: [number, number];
  toCoord: [number, number];
  durationMin: number;
  startTime: string; // ISO 8601 Z
  endTime: string;
  intermediateStops: string[];
  /** Leg estimé (navette aéroport) et non rejoué tel quel contre le GTFS. */
  estimated?: boolean;
}

export interface RouterItinerary {
  durationMin: number;
  transfers: number;
  startTime: string;
  endTime: string;
  legs: RouterLeg[];
}

export interface Router {
  readonly name: string;
  plan(
    from: TransitEndpoint,
    to: TransitEndpoint,
    timeIso: string,
    numItineraries?: number,
  ): Promise<RouterItinerary[]>;
}

/* ---------- Helpers de format ---------- */

/** Offset de Europe/Paris (minutes) à un instant donné. */
export function parisOffsetMinutes(at: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
  const nums = s.match(/\d+/g);
  if (!nums || nums.length < 6) return 60;
  const [mo, dy, yr, hh, mm, ss] = nums.map(Number);
  const asUtc = Date.UTC(yr!, mo! - 1, dy!, hh! % 24, mm!, ss!);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Instant « AAAA-MM-JJ à HH:MM à Paris » au format ISO 8601 UTC attendu par
 * MOTIS (ex. parisTimeIso("2026-11-23", "08:00") = "2026-11-23T07:00:00Z").
 */
export function parisTimeIso(dateKey: string, hhmm = "08:00"): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naiveUtc = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const offset = parisOffsetMinutes(new Date(naiveUtc));
  return new Date(naiveUtc - offset * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* ---------- Normalisation MOTIS ---------- */

interface MotisStop {
  name?: string;
  lat?: number;
  lon?: number;
  departure?: string;
  arrival?: string;
}
interface MotisLeg {
  mode?: string;
  from?: MotisStop;
  to?: MotisStop;
  duration?: number;
  startTime?: string;
  endTime?: string;
  routeShortName?: string;
  routeLongName?: string;
  agencyName?: string;
  tripShortName?: string;
  displayName?: string;
  intermediateStops?: Array<Partial<MotisStop>>;
}
interface MotisItinerary {
  duration?: number;
  transfers?: number;
  startTime?: string;
  endTime?: string;
  legs?: MotisLeg[];
}
interface MotisResponse {
  itineraries?: MotisItinerary[];
}

/** Mode MOTIS → kind du journey. */
export function kindOfMotisMode(mode: string | undefined): LegKind {
  const m = (mode ?? "").toUpperCase();
  if (m.includes("RAIL")) return "rail"; // HIGHSPEED_RAIL, REGIONAL_RAIL, RAIL
  if (m === "WALK") return "connection";
  return "urban"; // SUBWAY, TRAM, BUS, FERRY
}

/** Lettres de lignes RER (les Transilien utilisent H, J, L, N, P, R, U…). */
const RER_LETTERS = new Set(["A", "B", "C", "D", "E"]);

/**
 * Libellé humain du mode (indice A/B). Un REGIONAL_RAIL en ligne A–E est un
 * RER (ex. « B » à Paris = RER B, pas un « TER B ») ; en Transilien c'est une
 * ligne Transilien (« N ») ; sinon c'est un TER.
 */
export function modeDetailOf(mode: string | undefined, agency: string, shortName = ""): string {
  const m = (mode ?? "").toUpperCase();
  if (m === "HIGHSPEED_RAIL") return "TGV";
  if (m === "REGIONAL_RAIL") {
    // Réseaux urbains ferrés par marque (évite « TER » pour le DLR londonien).
    if (/DLR/i.test(agency)) return "DLR";
    if (/overground/i.test(agency)) return "Overground";
    if (/elizabeth/i.test(agency)) return "Elizabeth line";
    if (RER_LETTERS.has(shortName.toUpperCase())) return "RER";
    return /transilien/i.test(agency) ? "Transilien" : "TER";
  }
  if (m === "SUBWAY") return "Métro";
  if (m === "TRAM") return "Tram";
  if (m === "BUS") return "Bus";
  if (m === "FERRY") return "Ferry";
  if (m === "WALK") return "Marche à pied";
  return m || "Transport";
}

/** « TGV INOUI 8604 » → « TGV INOUI » ; « N » + Transilien → « Transilien N » ; « B » → « RER B ». */
export function lineOf(leg: MotisLeg, kind: LegKind = kindOfMotisMode(leg.mode)): string {
  const short = (leg.routeShortName ?? "").replace(/\s+\d+$/, "").trim();
  const long = (leg.routeLongName ?? "").trim();
  const agency = leg.agencyName ?? "";
  let base = short || long || leg.displayName || leg.tripShortName || "";
  // Un bus de substitution rail a parfois le routeShortName « TER 421708 » :
  // dans ce cas ce n'est PAS une ligne de train, on garde le nom long / « Navette ».
  if (kind === "urban" && /^TER\s*\d*$/i.test(base)) {
    base = long && !/^TER\s*\d*$/i.test(long) ? long : leg.displayName && !/^TER\s*\d*$/i.test(leg.displayName) ? leg.displayName : "Navette";
  }
  if (/transilien/i.test(agency) && /^[A-Z]$/i.test(base)) return "Transilien " + base.toUpperCase();
  if (kind === "rail" && RER_LETTERS.has(base.toUpperCase()) && base.length === 1) return "RER " + base.toUpperCase();
  return base;
}

function coordOf(stop: MotisStop | undefined): [number, number] {
  return [Number(stop?.lat ?? 0), Number(stop?.lon ?? 0)];
}

/** Normalise un itinéraire MOTIS en RouterItinerary (arrêts intermédiaires inclus). */
export function normalizeItinerary(it: MotisItinerary): RouterItinerary {
  const legs: RouterLeg[] = [];
  for (const leg of it.legs ?? []) {
    const mode = leg.mode ?? "WALK";
    const kind = kindOfMotisMode(mode);
    const agency = leg.agencyName ?? "";
    const stops = (leg.intermediateStops ?? [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    const fromName = leg.from?.name ?? "";
    const toName = leg.to?.name ?? "";
    const shortName = (leg.routeShortName ?? "").trim();
    // Les extrémités ne comptent pas comme arrêts intermédiaires.
    const inner = stops.filter((n) => n !== fromName && n !== toName);
    legs.push({
      mode,
      kind,
      modeDetail: kind === "connection" ? "Correspondance" : modeDetailOf(mode, agency, shortName),
      lineOrCarrier: kind === "connection" ? "" : lineOf(leg, kind),
      from: fromName,
      to: toName,
      fromCoord: coordOf(leg.from),
      toCoord: coordOf(leg.to),
      durationMin: Math.max(0, Math.round((leg.duration ?? 0) / 60)),
      startTime: leg.startTime ?? leg.from?.departure ?? "",
      endTime: leg.endTime ?? leg.to?.arrival ?? "",
      intermediateStops: inner,
    });
  }
  return {
    durationMin: Math.round((it.duration ?? 0) / 60),
    transfers: it.transfers ?? 0,
    startTime: it.startTime ?? "",
    endTime: it.endTime ?? "",
    legs,
  };
}

/* ---------- Sélection « optimal » ---------- */

/** Score = durée + pénalité par correspondance. */
export function itineraryScore(it: RouterItinerary): number {
  return it.durationMin + TRANSFER_PENALTY_MIN * it.transfers;
}

/**
 * Choisit l'itinéraire « optimal » parmi les réalistes :
 *   1. le moins de correspondances d'abord (un trajet direct ou à une seule
 *      correspondance est préféré — ex. Rennes → Mantes-la-Jolie : TGV +
 *      Transilien N plutôt que TGV + métro + TER, pourtant un peu plus lent) ;
 *   2. à nombre de correspondances égal, le plus rapide (durée, puis arrivée) ;
 *   3. garde-fou : si l'itinéraire à correspondances minimales est plus de
 *      2× plus lent que le plus rapide absolu, on prend le plus rapide.
 */
export function selectItinerary(itineraries: RouterItinerary[]): RouterItinerary | null {
  if (itineraries.length === 0) return null;
  const byDuration = [...itineraries].sort(
    (a, b) => a.durationMin - b.durationMin || (a.endTime || "Z").localeCompare(b.endTime || "Z"),
  );
  const fastest = byDuration[0]!;
  const minTransfers = Math.min(...itineraries.map((it) => it.transfers));
  const fewest = byDuration.filter((it) => it.transfers === minTransfers)[0]!;
  if (fewest.durationMin <= 2 * fastest.durationMin) return fewest;
  return fastest;
}

/* ---------- Conversion en journey (§4) ---------- */

/**
 * Convertit un RouterItinerary en segments de journey. Les gares de
 * correspondance (extrémité de chaque leg de transport) sont ajoutées comme
 * arrêts intermédiaires de leur segment : ce sont de vraies étapes du trajet
 * (source de l'indice D).
 *
 * Les pseudo-lieux START/END (legs à pied d'accès/arrivée) sont rebaptisés
 * AVEC LE CONTEXTE : START → origine du leg suivant, END → destination du leg
 * précédent (correct même quand deux itinéraires sont concaténés, ex.
 * accès aéroport + vol + arrivée aéroport).
 */
export function itineraryToSegments(it: RouterItinerary): JourneySegment[] {
  const transitIndices = it.legs.map((l, i) => (l.kind === "connection" ? -1 : i)).filter((i) => i >= 0);
  const lastTransit = transitIndices[transitIndices.length - 1] ?? -1;
  return it.legs.map((leg, i) => {
    let from = leg.from;
    let to = leg.to;
    if (from === "START") {
      const next = it.legs[i + 1];
      from = next && next.from !== "START" ? next.from : leg.to;
    }
    if (to === "END") {
      const prev = it.legs[i - 1];
      to = prev && prev.to !== "END" ? prev.to : leg.from;
    }
    const stops = [...leg.intermediateStops];
    // La gare d'arrivée d'un leg de transport (sauf le dernier) est une étape
    // réelle — sauf pour l'avion : l'aéroport d'arrivée est la destination.
    if (
      leg.kind !== "connection" &&
      leg.kind !== "air" &&
      !leg.estimated &&
      i !== lastTransit &&
      to &&
      !stops.includes(to)
    ) {
      stops.push(to);
    }
    const segment: JourneySegment = {
      index: i + 1,
      kind: leg.kind,
      modeDetail: leg.modeDetail,
      lineOrCarrier: leg.lineOrCarrier,
      durationMin: leg.durationMin,
      from,
      to,
      fromCoord: leg.fromCoord,
      toCoord: leg.toCoord,
    };
    // Horaires réels du leg : la vérification rejoue chaque segment à SON
    // horaire (et non à 08:00), pour valider le bon train/ligne (§M2).
    if (leg.startTime) segment.startTime = leg.startTime;
    if (leg.endTime) segment.endTime = leg.endTime;
    if (leg.estimated) segment.estimated = true;
    if (stops.length > 0) segment.intermediateStops = stops;
    return segment;
  });
}

/* ---------- Client ---------- */

export class TransitousRouter implements Router {
  readonly name = "transitous";
  constructor(private readonly baseUrl: string = TRANSITOUS_BASE_URL) {}

  async plan(
    from: TransitEndpoint,
    to: TransitEndpoint,
    timeIso: string,
    numItineraries = 8,
  ): Promise<RouterItinerary[]> {
    const params = new URLSearchParams({
      fromPlace: from.lat + "," + from.lng,
      toPlace: to.lat + "," + to.lng,
      time: timeIso,
      numItineraries: String(numItineraries),
      passengers: "0", // vélos non pris en compte
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.baseUrl + "/api/v1/plan?" + params.toString(), {
        headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const json = (await res.json()) as MotisResponse;
      return (json.itineraries ?? []).map(normalizeItinerary);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Géocodage (CLI check:itinerary).
   * @param preferStop true → préfère un arrêt STOP (gare) à une PLACE (ville) :
   *                   on planifie gare → gare quand la ville a une gare.
   */
  async geocode(text: string, preferStop = false): Promise<TransitEndpoint | null> {
    const hits = await this.geocodeAll(text);
    if (hits.length === 0) return null;
    const place = preferStop
      ? (hits.find((p) => p.type === "STOP") ?? hits.find((p) => p.type === "PLACE") ?? hits[0])
      : (hits.find((p) => p.type === "PLACE") ?? hits.find((p) => p.type === "STOP") ?? hits[0]);
    return { name: place!.name, lat: place!.lat, lng: place!.lng };
  }

  /** Tous les candidats géocodés (avec leur type STOP/PLACE). */
  async geocodeAll(text: string): Promise<Array<TransitEndpoint & { type?: string }>> {
    const params = new URLSearchParams({ text, count: "10" });
    try {
      const res = await fetch(this.baseUrl + "/api/v1/geocode?" + params.toString(), {
        headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as Array<{ name?: string; lat?: number; lon?: number; type?: string }>;
      return json
        .filter((p) => typeof p.lat === "number" && typeof p.lon === "number")
        .map((p) => ({ name: p.name ?? text, lat: p.lat as number, lng: p.lon as number, type: p.type }));
    } catch {
      return [];
    }
  }
}

/**
 * Résout le point de planification d'une ville : sa gare (STOP) si elle en a
 * une et que preferStation, sinon la ville (PLACE), sinon ses coordonnées.
 *
 * Désambiguïsation : quand la ville a des coordonnées connues (base de
 * données), on choisit le candidat géocodé LE PLUS PROCHE de ces coordonnées
 * — sinon « Vienna » pouvait renvoyer Vienna (Virginia, USA) !
 */
export async function resolveEndpoint(
  router: Router & {
    geocode?: (text: string, preferStop?: boolean) => Promise<TransitEndpoint | null>;
    geocodeAll?: (text: string) => Promise<Array<TransitEndpoint & { type?: string }>>;
  },
  city: TransitEndpoint,
  preferStation: boolean,
): Promise<TransitEndpoint> {
  const hasRef = Number.isFinite(city.lat) && Number.isFinite(city.lng) && (city.lat !== 0 || city.lng !== 0);
  if (router.geocodeAll && hasRef) {
    const hits = await router.geocodeAll(city.name);
    if (hits.length > 0) {
      const sorted = hits
        .map((h) => ({ h, d: haversineKm(city.lat, city.lng, h.lat, h.lng) }))
        .sort((a, b) => a.d - b.d);
      const best = sorted[0]!;
      // Gare (STOP) proche du meilleur candidat si demandé.
      if (preferStation) {
        const stopNear = sorted.find((x) => x.h.type === "STOP" && x.d <= Math.max(best.d, 15));
        if (stopNear) {
          return { name: stopNear.h.name, lat: stopNear.h.lat, lng: stopNear.h.lng, country: city.country };
        }
      }
      return { name: best.h.name, lat: best.h.lat, lng: best.h.lng, country: city.country };
    }
  }
  if (router.geocode) {
    const found = await router.geocode(city.name, preferStation);
    if (found) return { ...found, country: city.country };
  }
  return city;
}
