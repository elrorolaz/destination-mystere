// Routeur d'itinéraires réels — interface commune.
//
// Par défaut : Transitous (MOTIS, GTFS Europe, AUCUNE CLÉ requise) — couvre la
// France (SNCF, Transilien, STAR…) et le reste de l'Europe. Si SNCF_API_TOKEN
// est renseigné et ROUTER=navitia, on peut utiliser l'API SNCF à la place.

import { hasSncfToken, navitiaJourneys, dateKeyToNavitiaDatetime } from "./sncf.ts";
import {
  TransitousRouter,
  kindOfMotisMode,
  type Router,
  type RouterItinerary,
  type RouterLeg,
  type TransitEndpoint,
} from "./transitous.ts";
import type { JourneySegment } from "./types.ts";

export type { Router, RouterItinerary, RouterLeg, TransitEndpoint };

/** Routeur Navitia (API SNCF) — un seul itinéraire (le plus court) par appel. */
export class NavitiaRouter implements Router {
  readonly name = "navitia";
  async plan(
    from: TransitEndpoint,
    to: TransitEndpoint,
    timeIso: string,
  ): Promise<RouterItinerary[]> {
    // timeIso (…Z) → clé Navitia AAAAMMJJTHHMMSS du jour du défi (08:00 Paris).
    const dateKey = timeIso.slice(0, 10);
    const segments = await navitiaJourneys(from, to, dateKeyToNavitiaDatetime(dateKey));
    if (!segments || segments.length === 0) return [];
    const legs: RouterLeg[] = segments.map((s: JourneySegment) => ({
      mode: s.kind === "rail" ? "REGIONAL_RAIL" : s.kind === "urban" ? "SUBWAY" : "WALK",
      kind: s.kind === "connection" ? "connection" : kindOfMotisMode(s.kind === "rail" ? "REGIONAL_RAIL" : "SUBWAY"),
      modeDetail: s.modeDetail,
      lineOrCarrier: s.lineOrCarrier,
      from: s.from,
      to: s.to,
      fromCoord: s.fromCoord ?? [from.lat, from.lng],
      toCoord: s.toCoord ?? [to.lat, to.lng],
      durationMin: s.durationMin,
      startTime: timeIso,
      endTime: timeIso,
      intermediateStops: s.intermediateStops ?? [],
    }));
    const durationMin = legs.reduce((a, l) => a + l.durationMin, 0);
    return [
      {
        durationMin,
        transfers: legs.filter((l) => l.kind === "connection").length,
        startTime: timeIso,
        endTime: timeIso,
        legs,
      },
    ];
  }
}

/** Routeur par défaut : Transitous sans clé ; Navitia si ROUTER=navitia + token. */
export function defaultRouter(): Router {
  if ((process.env.ROUTER ?? "").toLowerCase() === "navitia" && hasSncfToken()) {
    return new NavitiaRouter();
  }
  return new TransitousRouter();
}
