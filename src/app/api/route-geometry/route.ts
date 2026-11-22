// GET /api/route-geometry — tracés de fin de partie (M3).
// Refusé tant que la partie est ACTIVE (§7) : on ne trace rien avant la fin.
// Segments rail/urban : voies ferrées réelles via railPath (Overpass,
// séquentiel pour ménager l'API). Air : arc Bézier. Connection : ligne droite.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "../../../lib/db.ts";
import { haversineKm } from "../../../lib/geo/haversine.ts";
import { challengeDateFromKey, parisDateKey } from "../../../lib/paris-date.ts";
import type { SegmentTrace } from "../../../lib/game-types.ts";
import { getTodayChallenge } from "../../../server/challenge-store.ts";
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

export async function GET() {
  const store = await cookies();
  const guestKey = store.get(GUEST_COOKIE)?.value;
  if (!guestKey) {
    return NextResponse.json(
      { error: "Session introuvable, rechargez la page" },
      { status: 400 },
    );
  }

  const session = await db.gameSession.findUnique({
    where: {
      guestKey_challengeDate: {
        guestKey,
        challengeDate: challengeDateFromKey(parisDateKey()),
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Aucune partie en cours" }, { status: 404 });
  }
  if (session.status === "ACTIVE") {
    return NextResponse.json(
      { error: "Le tracé n'est révélé qu'à la fin de la partie" },
      { status: 403 },
    );
  }

  const challenge = await getTodayChallenge();
  if (!challenge) {
    return NextResponse.json({ error: "Aucun défi pour aujourd'hui" }, { status: 503 });
  }

  const journey = challenge.journey as unknown as Journey;
  const traces: SegmentTrace[] = [];
  // Boucle séquentielle volontaire : un appel Overpass à la fois.
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
      followsTracks,
      geometry,
    });
  }

  return NextResponse.json({ traces });
}
