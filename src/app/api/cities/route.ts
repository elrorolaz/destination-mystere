// GET /api/cities — couche « constellation » de la carte (M3).
// La carte demande les villes visibles selon le zoom (minPopulation croissant
// quand on dézoome) ; les bornes sont clampées côté serveur et le volume
// plafonné. Aucune donnée de partie ici : uniquement le référentiel de villes.

import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../lib/db.ts";
import type { CityMapPoint } from "../../../lib/game-types.ts";

export const dynamic = "force-dynamic";

const MAX_CITIES = 6000;

function clampParam(params: URLSearchParams, key: string, min: number, max: number, dflt: number): number {
  const raw = Number(params.get(key));
  if (!Number.isFinite(raw)) return dflt;
  return Math.min(max, Math.max(min, raw));
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const minLat = clampParam(params, "minLat", -90, 90, 35);
  const maxLat = clampParam(params, "maxLat", -90, 90, 72);
  const minLng = clampParam(params, "minLng", -180, 180, -12);
  const maxLng = clampParam(params, "maxLng", -180, 180, 42);
  const minPopulation = clampParam(params, "minPopulation", 0, 20_000_000, 80_000);

  const rows = await db.city.findMany({
    where: {
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
      population: { gte: minPopulation },
    },
    select: {
      id: true,
      name: true,
      country: true,
      lat: true,
      lng: true,
      population: true,
      hasTrainStation: true,
    },
    orderBy: { population: "desc" },
    take: MAX_CITIES,
  });

  const cities: CityMapPoint[] = rows;
  return NextResponse.json({ cities });
}
