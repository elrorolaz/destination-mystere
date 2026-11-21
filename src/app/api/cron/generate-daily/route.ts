// POST /api/cron/generate-daily — génère le défi du jour (M2, spécification §6).
//
//   - protégé par CRON_SECRET : « Authorization: Bearer <CRON_SECRET> » ;
//   - génère AUJOURD'HUI (Europe/Paris) et DEMAIN (J+1 en avance, §6.5) ;
//   - idempotent : une date qui a déjà un défi est laissée telle quelle
//     (relancer deux fois donne le même duo de villes, §6.2) ;
//   - repli : si la génération échoue (API SNCF indisponible, etc.), le
//     fixture data/fixtures/demo-journey.json est chargé à la place (§6.5).
//
// Déclenchement : vercel.json (cron 05:00 Europe/Paris), GitHub Actions ou
// node-cron sur VPS. En local : npm run challenge:generate.

import { NextRequest, NextResponse } from "next/server";
import { challengeDateFromKey, parisDateKey } from "../../../../lib/paris-date.ts";
import {
  generateDailyChallenge,
  upsertDailyChallenge,
} from "../../../../server/daily-challenge.ts";
import {
  fallbackToFixtureChallenge,
  getTodayChallenge,
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
    const existing = await db.dailyChallenge.findUnique({ where: { challengeDate: date } });
    if (existing) {
      results.push({ date: dateKey, status: "exists" });
      continue;
    }
    try {
      const challenge = await generateDailyChallenge(dateKey);
      await upsertDailyChallenge(challenge, date);
      results.push({
        date: dateKey,
        status: "created",
        source: challenge.source,
        zone: challenge.zone,
        totalDurationMin: challenge.totalDurationMin,
        segments: challenge.segments.length,
      });
    } catch (err) {
      console.error("generate-daily " + dateKey + " : échec, repli sur le fixture", err);
      const fallback = await fallbackToFixtureChallenge(date);
      if (fallback) {
        results.push({
          date: dateKey,
          status: "fallback",
          origin: fallback.originCity.name,
          destination: fallback.destinationCity.name,
          totalDurationMin: fallback.totalDurationMin,
        });
      } else {
        results.push({ date: dateKey, status: "error", error: "génération et repli ont échoué" });
      }
    }
  }
  return NextResponse.json({ ok: true, results });
}

/** GET de santé : indique si le cron est configuré (sans le révéler). */
export async function GET() {
  const configured = typeof process.env.CRON_SECRET === "string" && process.env.CRON_SECRET.length > 0;
  const today = await getTodayChallenge().catch(() => null);
  return NextResponse.json({
    cronConfigured: configured,
    todayChallenge: today
      ? {
          date: parisDateKey(),
          origin: today.originCity.name,
          destination: today.destinationCity.name,
          totalDurationMin: today.totalDurationMin,
        }
      : null,
  });
}
