// Client API SNCF (Navitia) — trains et transports publics (spécification §5.1).
//
//   - endpoint : https://api.sncf.com/v1/coverage/sncf/… (doc.navitia.io) ;
//   - auth HTTP Basic : username = SNCF_API_TOKEN, mot de passe vide ;
//   - /journeys porte-à-porte, horaires THÉORIQUES (data_freshness=theoretical,
//     §10 : on ne bâtit pas sur le temps réel) ;
//   - quota ~5 000 req/jour, la génération ne tourne qu'une fois par jour.
//
// Toute erreur (réseau, 401, JSON invalide, aucun trajet) → null : le planner
// bascule alors sur l'estimation paramétrique.

import { normalizeLineLabel } from "./line-names.ts";
import type { JourneySegment } from "./types.ts";

const SNCF_BASE_URL = "https://api.sncf.com/v1/coverage/sncf";
const REQUEST_TIMEOUT_MS = 15000;

export function hasSncfToken(): boolean {
  return typeof process.env.SNCF_API_TOKEN === "string" && process.env.SNCF_API_TOKEN.length > 0;
}

/* ---------- Formes minimales de la réponse Navitia ---------- */

interface NavitiaCoord {
  lat?: string;
  lon?: string;
}
interface NavitiaStopPoint {
  name?: string;
  coord?: NavitiaCoord;
}
interface NavitiaStopDateTime {
  stop_point?: NavitiaStopPoint;
}
interface NavitiaPlace {
  name?: string;
  stop_point?: NavitiaStopPoint;
}
interface NavitiaSection {
  type?: string;
  mode?: string;
  physical_mode?: { name?: string };
  duration?: number; // secondes
  from?: NavitiaPlace;
  to?: NavitiaPlace;
  display_informations?: {
    label?: string;
    network?: string;
    commercial_mode?: { name?: string };
    physical_mode?: { name?: string };
  };
  stop_date_times?: NavitiaStopDateTime[];
}
interface NavitiaJourney {
  duration?: number; // secondes
  nb_transfers?: number;
  sections?: NavitiaSection[];
}
interface NavitiaResponse {
  journeys?: NavitiaJourney[];
  error?: { id?: string; message?: string };
}

export interface SncfEndpoint {
  name: string;
  lat: number;
  lng: number;
}

/* ---------- Normalisation ---------- */

/** Mode de transport d'un tronçon Navitia → kind du journey (§4). */
export function kindFromPhysicalMode(physicalMode: string | undefined, fallbackMode: string | undefined): JourneySegment["kind"] {
  const m = (physicalMode ?? fallbackMode ?? "").toLowerCase();
  if (m.includes("train") || m.includes("rail") || m.includes("ter") || m.includes("tgv") || m.includes("intercity")) {
    return "rail";
  }
  // métro, tram, bus, car, ferry, rapid transit → transports urbains
  return "urban";
}

/** Nom de ligne/compagnie d'un tronçon Navitia (indice C). */
function lineLabelOf(section: NavitiaSection): string {
  const di = section.display_informations;
  const raw =
    di?.commercial_mode?.name ??
    di?.label ??
    di?.network ??
    di?.physical_mode?.name ??
    section.physical_mode?.name ??
    "";
  // EST → Eurostar, IC → Intercités, métro « 14 » → « métro 14 ».
  const modeDetail = di?.physical_mode?.name ?? section.physical_mode?.name ?? "";
  return normalizeLineLabel(raw, modeDetail);
}

function coordOf(place: NavitiaPlace | undefined): [number, number] | undefined {
  const lat = Number(place?.stop_point?.coord?.lat);
  const lon = Number(place?.stop_point?.coord?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return [lat, lon];
}

/**
 * Normalise un itinéraire Navitia (sections) en segments de journey.
 * Les correspondances (walking, waiting, transfer, stay_in) deviennent des
 * segments « connection » ; les arrêts desservis alimentent l'indice D.
 */
export function normalizeNavitiaJourney(journey: NavitiaJourney): JourneySegment[] {
  const segments: JourneySegment[] = [];
  let index = 1;
  for (const section of journey.sections ?? []) {
    const from = section.from?.name ?? "";
    const to = section.to?.name ?? "";
    const durationMin = Math.max(1, Math.round((section.duration ?? 0) / 60));
    const isTransport = section.type === "public_transport";
    const stops = (section.stop_date_times ?? [])
      .map((sdt) => sdt.stop_point?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    // stop_date_times inclut les extrémités : on ne garde que l'intérieur.
    const inner = stops.slice(1, Math.max(1, stops.length - 1));
    segments.push({
      index: index++,
      kind: isTransport ? kindFromPhysicalMode(section.physical_mode?.name, section.mode) : "connection",
      modeDetail: isTransport
        ? (section.display_informations?.physical_mode?.name ?? section.physical_mode?.name ?? "Transport")
        : "Correspondance",
      lineOrCarrier: isTransport ? lineLabelOf(section) : "",
      durationMin,
      from,
      to,
      ...(inner.length > 0 ? { intermediateStops: inner } : {}),
      ...(coordOf(section.from) ? { fromCoord: coordOf(section.from) } : {}),
      ...(coordOf(section.to) ? { toCoord: coordOf(section.to) } : {}),
    });
  }
  return segments;
}

/* ---------- Client ---------- */

/**
 * Itinéraires Navitia entre deux points (coordonnées « lon;lat » acceptées
 * directement par /journeys). Retourne les segments du trajet le plus court,
 * ou null si indisponible (pas de token, erreur réseau, 401, aucun trajet).
 *
 * @param datetime clé Navitia « AAAAMMJJTHHMMSS » (horaire théorique du jour
 *                 du défi à 08:00, fuseau de la couverture).
 */
export async function navitiaJourneys(
  from: SncfEndpoint,
  to: SncfEndpoint,
  datetime: string,
): Promise<JourneySegment[] | null> {
  const token = process.env.SNCF_API_TOKEN;
  if (!token) return null;

  const params = new URLSearchParams({
    from: from.lng + ";" + from.lat,
    to: to.lng + ";" + to.lat,
    datetime,
    count: "5",
    data_freshness: "theoretical",
    disable_geojson: "true",
  });
  const url = SNCF_BASE_URL + "/journeys?" + params.toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        // Basic auth : username = token, mot de passe vide (§5.1).
        Authorization: "Basic " + btoa(token + ":"),
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as NavitiaResponse;
    if (json.error || !json.journeys || json.journeys.length === 0) return null;
    let best: NavitiaJourney | null = null;
    for (const j of json.journeys) {
      if (!best || (j.duration ?? Infinity) < (best.duration ?? Infinity)) best = j;
    }
    if (!best) return null;
    const segments = normalizeNavitiaJourney(best);
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Convertit une clé AAAA-MM-JJ en datetime Navitia AAAAMMJJTHHMMSS (08:00). */
export function dateKeyToNavitiaDatetime(dateKey: string): string {
  return dateKey.replaceAll("-", "") + "T080000";
}
