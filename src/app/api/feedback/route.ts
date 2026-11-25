// POST /api/feedback — signalement « cet itinéraire est-il réaliste ? »
// (écran de résultat). Si realistic=true (ou pas de réponse) : RIEN n'est
// écrit. Si realistic=false : l'itinéraire du défi concerné est journalisé
// dans data/logs/unrealistic-itineraries.jsonl (lu en base, jamais le payload
// client) pour analyse des aberrations du générateur.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "../../../lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../../../lib/paris-date.ts";
import { ROUTE_COUNT } from "../../../lib/game-types.ts";
import { logUnrealisticItinerary } from "../../../server/feedback-log.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMENT = 500;

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }
    const { realistic, comment, date, route } = body as {
      realistic?: unknown;
      comment?: unknown;
      date?: unknown;
      route?: unknown;
    };
    if (typeof realistic !== "boolean") {
      return NextResponse.json({ error: "realistic (booléen) requis" }, { status: 400 });
    }
    // « Oui » (ou silence) : aucun effet de bord.
    if (realistic) {
      return NextResponse.json({ ok: true, logged: false });
    }

    // « Non » : on journalise l'itinéraire concerné (date + numéro
    // d'itinéraire 1..3 ; défaut = itinéraire 1).
    const dateKey =
      typeof date === "string" && DATE_RE.test(date) ? date : parisDateKey();
    const routeIndex =
      typeof route === "number" && Number.isInteger(route) && route >= 1 && route <= ROUTE_COUNT
        ? route
        : 1;
    const dailyRoute = await db.dailyRoute.findUnique({
      where: {
        challengeDate_routeIndex: {
          challengeDate: challengeDateFromKey(dateKey),
          routeIndex,
        },
      },
      include: { originCity: true, destinationCity: true },
    });
    if (!dailyRoute) {
      return NextResponse.json(
        { error: "Itinéraire introuvable pour " + dateKey + " n°" + routeIndex },
        { status: 404 },
      );
    }
    const store = await cookies();
    logUnrealisticItinerary({
      ts: new Date().toISOString(),
      date: dateKey,
      routeIndex,
      guestKey: store.get(GUEST_COOKIE)?.value,
      comment:
        typeof comment === "string" && comment.trim().length > 0
          ? comment.trim().slice(0, MAX_COMMENT)
          : undefined,
      origin: {
        id: dailyRoute.originCity.id,
        name: dailyRoute.originCity.name,
        country: dailyRoute.originCity.country,
      },
      destination: {
        id: dailyRoute.destinationCity.id,
        name: dailyRoute.destinationCity.name,
        country: dailyRoute.destinationCity.country,
      },
      totalDurationMin: dailyRoute.totalDurationMin,
      journey: dailyRoute.journey,
    });
    return NextResponse.json({ ok: true, logged: true });
  } catch (err) {
    console.error("POST /api/feedback :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
