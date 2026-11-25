// GET /api/route-geometry — tracés de fin de manche / de match (M3+).
//
//   - ?route=N (1..3, défaut = manche courante du match) : tracé de
//     l'itinéraire N, autorisé seulement si la manche N est terminée (§7) ;
//   - ?all=1 : les TROIS itinéraires du match (avec routeIndex sur chaque
//     tracé, pour les distinguer sur la carte), autorisé seulement si le
//     match est terminé (3 manches finies).
//
// Segments rail/urban : voies ferrées réelles via railPath (Overpass,
// séquentiel pour ménager l'API). Air : arc Bézier. Connection : ligne droite.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../lib/db.ts";
import { haversineKm } from "../../../lib/geo/haversine.ts";
import { challengeDateFromKey, parisDateKey } from "../../../lib/paris-date.ts";
import { ROUTE_COUNT, type SegmentTrace } from "../../../lib/game-types.ts";
import { getRoute } from "../../../server/challenge-store.ts";
import { airArc, railPath, smoothArc, type LatLon } from "../../../server/routing/rail-geometry.ts";
import { defaultRouter } from "../../../server/routing/router.ts";
import type { Journey } from "../../../server/routing/types.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

/* ---------- Repli routeur : géométrie réelle du leg via MOTIS ---------- */

// Quand Overpass (OpenStreetMap) est indisponible, on rejoue le segment auprès
// du routeur (Transitous/MOTIS) à SON horaire de départ : le leg renvoyé porte
// sa géométrie réelle (legGeometry, voies GTFS) — le tracé suit alors quand
// même les vraies voies, sans dépendre d'Overpass.

const routerGeomCache = new Map<string, { at: number; geometry: LatLon[] }>();
const ROUTER_GEOM_TTL_MS = 6 * 60 * 60 * 1000;

async function routerLegGeometry(
  from: LatLon,
  to: LatLon,
  timeIso?: string,
): Promise<LatLon[] | null> {
  const key = from[0].toFixed(4) + "," + from[1].toFixed(4) + ">" + to[0].toFixed(4) + "," + to[1].toFixed(4);
  const hit = routerGeomCache.get(key);
  if (hit && Date.now() - hit.at < ROUTER_GEOM_TTL_MS) return hit.geometry;

  try {
    const router = defaultRouter();
    const time = timeIso && timeIso.length >= 10 ? timeIso : new Date().toISOString();
    const itineraries = await router.plan(
      { name: "Départ", lat: from[0], lng: from[1] },
      { name: "Arrivée", lat: to[0], lng: to[1] },
      time,
      3,
    );
    let best: LatLon[] | null = null;
    for (const it of itineraries) {
      for (const leg of it.legs) {
        if (leg.kind === "connection" || !leg.geometry || leg.geometry.length < 2) continue;
        const g = leg.geometry;
        const first = g[0]!;
        const last = g[g.length - 1]!;
        const dStart = haversineKm(from[0], from[1], first[0], first[1]);
        const dEnd = haversineKm(to[0], to[1], last[0], last[1]);
        // Le leg doit couvrir le segment demandé (extrémités à < 15 km).
        if (dStart < 15 && dEnd < 15) {
          if (!best || g.length > best.length) best = g;
        }
      }
    }
    if (best) {
      routerGeomCache.set(key, { at: Date.now(), geometry: best });
      return best;
    }
  } catch {
    // routeur indisponible : repli ligne droite
  }
  return null;
}

/** Tracés d'un journey (boucle séquentielle volontaire : un Overpass à la fois). */
async function tracesForJourney(journey: Journey, routeIndex?: number): Promise<SegmentTrace[]> {
  const traces: SegmentTrace[] = [];
  for (const segment of journey.segments) {
    const from = segment.fromCoord;
    const to = segment.toCoord;
    if (!from || !to) continue;
    let geometry: LatLon[];
    let followsTracks = false;
    if (segment.kind === "air") {
      geometry = airArc(from, to);
      followsTracks = true;
    } else if (segment.kind === "connection") {
      geometry = [from, to];
    } else {
      // 1) Voies ferrées OpenStreetMap (Overpass) si joignable…
      const result = await railPath(from, to);
      if (result.followsTracks) {
        geometry = result.geometry;
        followsTracks = true;
      } else {
        // 2) …sinon géométrie réelle du leg rejoué auprès du routeur (MOTIS),
        //    qui suit les mêmes voies (GTFS) sans dépendre d'Overpass.
        const alt = await routerLegGeometry(from, to, segment.startTime);
        if (alt) {
          geometry = alt;
          followsTracks = true;
        } else {
          // Repli final : au lieu d'une ligne droite anguleuse, une courbe de
          // Bézier douce (bombée vers le nord) — le tracé reste lisse.
          geometry = smoothArc(from, to, 32, 0.06);
          followsTracks = false;
        }
      }
    }
    traces.push({
      index: segment.index,
      kind: segment.kind,
      routeIndex,
      followsTracks,
      geometry,
    });
  }
  return traces;
}

export async function GET(req: NextRequest) {
  const store = await cookies();
  const guestKey = store.get(GUEST_COOKIE)?.value;
  if (!guestKey) {
    return NextResponse.json(
      { error: "Session introuvable, rechargez la page" },
      { status: 400 },
    );
  }

  const date = challengeDateFromKey(parisDateKey());
  const session = await db.gameSession.findUnique({
    where: { guestKey_challengeDate: { guestKey, challengeDate: date } },
  });
  if (!session) {
    return NextResponse.json({ error: "Aucune partie en cours" }, { status: 404 });
  }
  const routeSessions = await db.routeSession.findMany({
    where: { sessionId: session.id },
    select: { routeIndex: true, status: true },
  });
  const statusOf = (slot: number): string | null =>
    routeSessions.find((r) => r.routeIndex === slot)?.status ?? null;

  const params = req.nextUrl.searchParams;
  const wantAll = params.get("all") === "1";
  const routeParam = Number(params.get("route") ?? session.currentRouteIndex);
  const routeIndex =
    Number.isInteger(routeParam) && routeParam >= 1 && routeParam <= ROUTE_COUNT
      ? routeParam
      : session.currentRouteIndex;

  if (wantAll) {
    // Les 3 itinéraires ne sont tracés qu'une fois le match terminé (§7).
    const allDone = [1, 2, 3].every((slot) => {
      const st = statusOf(slot);
      return st !== null && st !== "ACTIVE";
    });
    if (!allDone) {
      return NextResponse.json(
        { error: "Les 3 itinéraires ne sont révélés qu'à la fin du match" },
        { status: 403 },
      );
    }
    const traces: SegmentTrace[] = [];
    for (let slot = 1; slot <= ROUTE_COUNT; slot++) {
      const route = await getRoute(date, slot);
      if (!route) continue;
      const journey = route.journey as unknown as Journey;
      traces.push(...(await tracesForJourney(journey, slot)));
    }
    return NextResponse.json({ traces });
  }

  // Tracé d'une seule manche : autorisée seulement si elle est terminée.
  const status = statusOf(routeIndex);
  if (status === null || status === "ACTIVE") {
    return NextResponse.json(
      { error: "Le tracé n'est révélé qu'à la fin de l'itinéraire" },
      { status: 403 },
    );
  }
  const route = await getRoute(date, routeIndex);
  if (!route) {
    return NextResponse.json({ error: "Aucun itinéraire pour ce numéro" }, { status: 503 });
  }
  const journey = route.journey as unknown as Journey;
  const traces = await tracesForJourney(journey, routeIndex);
  return NextResponse.json({ traces });
}
