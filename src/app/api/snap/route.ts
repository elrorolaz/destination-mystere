// GET /api/snap?lat=&lng= — ville la plus proche d'un clic (design M3+).
// Sert UNIQUEMENT à la popup de confirmation (« Proposer « Reims » ? »)
// avant validation. Ne contient aucune donnée de partie : le snap sur la
// ville la plus proche est une information publique (la carte l'affiche).
// Pendant une manche, le snap est restreint aux villes « possibles » de
// l'itinéraire courant (même seuil que /api/cities et /api/guess, lu depuis
// la session invité côté serveur). La validation définitive reste 100 %
// serveur via POST /api/guess (§7).

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSnapperForFloor } from "../../../server/cities.ts";
import { currentRouteFloor } from "../../../server/game-service.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

function num(params: URLSearchParams, key: string): number | null {
  const raw = Number(params.get(key));
  return Number.isFinite(raw) ? raw : null;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lat = num(params, "lat");
  const lng = num(params, "lng");
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Coordonnées invalides" }, { status: 400 });
  }
  try {
    const store = await cookies();
    const snapper = await getSnapperForFloor(
      await currentRouteFloor(store.get(GUEST_COOKIE)?.value),
    );
    const { city, distanceKm } = snapper(lat, lng);
    return NextResponse.json({
      snap: {
        name: city.name,
        country: city.country,
        lat: city.lat,
        lng: city.lng,
        distanceKm: Math.round(distanceKm * 10) / 10,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Snap indisponible" },
      { status: 503 },
    );
  }
}
