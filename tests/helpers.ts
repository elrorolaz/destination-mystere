// Helpers de test : faux routeur (Router) pour planner/verify sans réseau.

import type {
  Router,
  RouterItinerary,
  RouterLeg,
  TransitEndpoint,
} from "../src/server/routing/transitous.ts";

export function makeLeg(
  kind: RouterLeg["kind"],
  from: string,
  to: string,
  opts: Partial<RouterLeg> & { fromCoord?: [number, number]; toCoord?: [number, number] } = {},
): RouterLeg {
  return {
    mode: kind === "rail" ? "REGIONAL_RAIL" : kind === "urban" ? "SUBWAY" : kind === "connection" ? "WALK" : "AIR",
    kind,
    modeDetail: opts.modeDetail ?? (kind === "rail" ? "TER" : kind === "urban" ? "Métro" : kind === "connection" ? "Correspondance" : "Avion"),
    lineOrCarrier: opts.lineOrCarrier ?? (kind === "connection" ? "" : "TER"),
    from,
    to,
    fromCoord: opts.fromCoord ?? [48.85, 2.35],
    toCoord: opts.toCoord ?? [49.26, 4.03],
    durationMin: opts.durationMin ?? 60,
    startTime: opts.startTime ?? "2026-11-23T07:00:00Z",
    endTime: opts.endTime ?? "2026-11-23T08:00:00Z",
    intermediateStops: opts.intermediateStops ?? [],
  };
}

export function makeItin(legs: RouterLeg[], transfers?: number): RouterItinerary {
  return {
    durationMin: legs.reduce((a, l) => a + l.durationMin, 0),
    transfers: transfers ?? legs.filter((l) => l.kind === "connection").length,
    startTime: legs[0]?.startTime ?? "",
    endTime: legs[legs.length - 1]?.endTime ?? "",
    legs,
  };
}

/** Faux routeur : délègue à un handler (from, to, timeIso?) → itinéraires. */
export class FakeRouter implements Router {
  readonly name = "fake";
  constructor(
    private readonly handler: (
      from: TransitEndpoint,
      to: TransitEndpoint,
      timeIso?: string,
    ) => RouterItinerary[],
  ) {}
  plan(from: TransitEndpoint, to: TransitEndpoint, timeIso?: string): Promise<RouterItinerary[]> {
    return Promise.resolve(this.handler(from, to, timeIso));
  }
}
