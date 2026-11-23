// POST /api/feedback — signalement « cet itinéraire est-il réaliste ? »
// (écran de résultat). Si realistic=true (ou pas de réponse) : RIEN n'est
// écrit. Si realistic=false : l'itinéraire du défi concerné est journalisé
// dans data/logs/unrealistic-itineraries.jsonl (lu en base, jamais le payload
// client) pour analyse des aberrations du générateur.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "../../../lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../../../lib/paris-date.ts";
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
    const { realistic, comment, date } = body as {
      realistic?: unknown;
      comment?: unknown;
      date?: unknown;
    };
    if (typeof realistic !== "boolean") {
      return NextResponse.json({ error: "realistic (booléen) requis" }, { status: 400 });
    }
    // « Oui » (ou silence) : aucun effet de bord.
    if (realistic) {
      return NextResponse.json({ ok: true, logged: false });
    }

    // « Non » : on journalise le défi correspondant à la date demandée
    // (AAAA-MM-JJ validée, défaut = jour Europe/Paris).
    const dateKey =
      typeof date === "string" && DATE_RE.test(date) ? date : parisDateKey();
    const challenge = await db.dailyChallenge.findUnique({
      where: { challengeDate: challengeDateFromKey(dateKey) },
      include: { originCity: true, destinationCity: true },
    });
    if (!challenge) {
      return NextResponse.json({ error: "Défi introuvable pour " + dateKey }, { status: 404 });
    }
    const store = await cookies();
    logUnrealisticItinerary({
      ts: new Date().toISOString(),
      date: dateKey,
      guestKey: store.get(GUEST_COOKIE)?.value,
      comment:
        typeof comment === "string" && comment.trim().length > 0
          ? comment.trim().slice(0, MAX_COMMENT)
          : undefined,
      origin: {
        id: challenge.originCity.id,
        name: challenge.originCity.name,
        country: challenge.originCity.country,
      },
      destination: {
        id: challenge.destinationCity.id,
        name: challenge.destinationCity.name,
        country: challenge.destinationCity.country,
      },
      totalDurationMin: challenge.totalDurationMin,
      journey: challenge.journey,
    });
    return NextResponse.json({ ok: true, logged: true });
  } catch (err) {
    console.error("POST /api/feedback :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
