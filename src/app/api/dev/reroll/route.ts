// POST /api/dev/reroll — régénère TROIS itinéraires de test aléatoires pour
// aujourd'hui et efface les parties du jour (M3+, développement uniquement).
// Réservé à DEV_FIXTURE=random : en mode « true » (fixture figé) ou en
// production, aucun sens — 403.

import { NextResponse } from "next/server";
import {
  devFixtureMode,
  rerollTodayRoutes,
} from "../../../../server/challenge-store.ts";

export const dynamic = "force-dynamic";

export async function POST() {
  if (devFixtureMode() !== "random") {
    return NextResponse.json(
      { error: "Le reroll n'est possible qu'avec DEV_FIXTURE=random" },
      { status: 403 },
    );
  }
  try {
    const routes = await rerollTodayRoutes();
    if (routes.length === 0) {
      return NextResponse.json(
        { error: "Génération impossible (villes en base ?)" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      routes: routes.map((r) => ({
        routeIndex: r.routeIndex,
        origin: r.originCity.name,
        destination: r.destinationCity.name,
        totalDurationMin: r.totalDurationMin,
      })),
    });
  } catch (err) {
    console.error("POST /api/dev/reroll :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
