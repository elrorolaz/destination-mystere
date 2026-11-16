// GET /api/route-geometry — tracés de fin de partie (M3).
// Refusé tant que la partie est ACTIVE (§7) : on ne trace rien avant la fin.
// Segments rail/urban : voies ferrées réelles via railPath (Overpass,
// séquentiel pour ménager l'API). Air : arc Bézier. Connection : ligne droite.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "../../../lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../../../lib/paris-date.ts";
import type { SegmentTrace } from "../../../lib/game-types.ts";
import { getTodayChallenge } from "../../../server/challenge-store.ts";
import { airArc, railPath, type LatLon } from "../../../server/routing/rail-geometry.ts";
import type { Journey } from "../../../server/routing/types.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

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

  const journey = challenge.journey as Journey;
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
      const result = await railPath(from, to);
      geometry = result.geometry;
      followsTracks = result.followsTracks;
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
