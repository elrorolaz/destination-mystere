// POST /api/cron/generate-daily — génère les TROIS itinéraires du jour (M2+,
// spécification §6).
//
//   - protégé par CRON_SECRET : « Authorization: Bearer <CRON_SECRET> » ;
//   - génère AUJOURD'HUI (Europe/Paris) et DEMAIN (J+1 en avance, §6.5) ;
//   - idempotent : un itinéraire (date, n°) déjà présent est laissé tel quel
//     (relancer deux fois donne les mêmes duos de villes, §6.2) ;
//   - repli : si la génération d'un itinéraire échoue (API indisponible,
//     etc.), le fixture data/fixtures/demo-journey.json est chargé à sa place
//     (§6.5).
//
// Déclenchement : vercel.json (cron 05:00 Europe/Paris), GitHub Actions ou
// node-cron sur VPS. En local : npm run challenge:generate.

import { NextRequest, NextResponse } from "next/server";
import { challengeDateFromKey, parisDateKey } from "../../../../lib/paris-date.ts";
import { ROUTE_COUNT } from "../../../../lib/game-types.ts";
import {
  generateRouteForSlot,
  getRoute,
  getTodayRoutes,
} from "../../../../server/challenge-store.ts";
import { db } from "../../../../lib/db.ts";

export const dynamic = "force-dynamic";

/** Clés de dates à générer : aujourd'hui + demain (J+1 en avance, §6.5). */
function defaultDateKeys(): string[] {
  const today = parisDateKey();
  const tomorrow = parisDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  return today === tomorrow ? [today] : [today, tomorrow];
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET non configuré : cron refusé" },
      { status: 403 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + secret) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let dateKeys = defaultDateKeys();
  try {
    const body = (await req.json()) as { dates?: unknown };
    if (Array.isArray(body.dates)) {
      const valid = body.dates.filter(
        (d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
      );
      if (valid.length > 0) dateKeys = valid;
    }
  } catch {
    // corps absent ou invalide : dates par défaut
  }

  const results = [];
  for (const dateKey of dateKeys) {
    const date = challengeDateFromKey(dateKey);
    await db.dailyChallenge.upsert({
      where: { challengeDate: date },
      create: { challengeDate: date },
      update: {},
    });
    const dateResults = [];
    for (let slot = 1; slot <= ROUTE_COUNT; slot++) {
      const existing = await getRoute(date, slot);
      if (existing) {
        dateResults.push({ route: slot, status: "exists" });
        continue;
      }
      const route = await generateRouteForSlot(date, dateKey, slot);
      if (route) {
        dateResults.push({
          route: slot,
          status: "created",
          origin: route.originCity.name,
          destination: route.destinationCity.name,
          totalDurationMin: route.totalDurationMin,
        });
      } else {
        dateResults.push({ route: slot, status: "error", error: "génération et repli ont échoué" });
      }
    }
    results.push({ date: dateKey, routes: dateResults });
  }
  return NextResponse.json({ ok: true, results });
}

/** GET de santé : indique si le cron est configuré (sans le révéler). */
export async function GET() {
  const configured = typeof process.env.CRON_SECRET === "string" && process.env.CRON_SECRET.length > 0;
  const routes = await getTodayRoutes().catch(() => []);
  return NextResponse.json({
    cronConfigured: configured,
    todayRoutes: routes.map((r) => ({
      date: parisDateKey(),
      routeIndex: r.routeIndex,
      origin: r.originCity.name,
      destination: r.destinationCity.name,
      totalDurationMin: r.totalDurationMin,
    })),
  });
}
