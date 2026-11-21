// POST /api/dev/reroll — régénère un itinéraire de test aléatoire pour
// aujourd'hui et efface les parties du jour (M3, développement uniquement).
// Réservé à DEV_FIXTURE=random : en mode « true » (fixture figé) ou en
// production, aucun sens — 403.

import { NextResponse } from "next/server";
import {
  devFixtureMode,
  rerollTodayChallenge,
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
    const challenge = await rerollTodayChallenge();
    if (!challenge) {
      return NextResponse.json(
        { error: "Génération impossible (villes en base ?)" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      date: challenge.challengeDate,
      origin: challenge.originCity.name,
      destination: challenge.destinationCity.name,
      totalDurationMin: challenge.totalDurationMin,
    });
  } catch (err) {
    console.error("POST /api/dev/reroll :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
