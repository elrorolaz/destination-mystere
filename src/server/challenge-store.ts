// Défi du jour : lecture en base, et chargement d'un itinéraire de test
// quand aucun défi n'existe et que DEV_FIXTURE est actif :
//   - DEV_FIXTURE=true   → fixture figé data/fixtures/demo-journey.json
//                          (chemin déterministe décrit au README, § « Premier test ») ;
//   - DEV_FIXTURE=random → itinéraire aléatoire (bouton 🎲 /api/dev/reroll pour
//                          en changer à volonté pendant les tests).
// La génération quotidienne réelle arrive avec M2 (cron + PRNG + clients SNCF/vols).

import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "../lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../lib/paris-date.ts";
import type { DailyJourney, Journey } from "./routing/types.ts";
import { mergeEdgeConnections } from "./routing/cleanup.ts";
import { pickRandomChallenge } from "./dev-journey.ts";

export type ChallengeWithCities = Prisma.DailyChallengeGetPayload<{
  include: { originCity: true; destinationCity: true };
}>;

/** Défi du jour (date Europe/Paris). Null : rien pour aujourd'hui. */
export async function getTodayChallenge(): Promise<ChallengeWithCities | null> {
  const date = challengeDateFromKey(parisDateKey());
  const existing = await db.dailyChallenge.findUnique({
    where: { challengeDate: date },
    include: { originCity: true, destinationCity: true },
  });
  if (existing) return existing;
  const mode = devFixtureMode();
  if (mode === "random") return seedRandomChallenge(date);
  if (mode === "fixed") return seedFixtureChallenge(date);
  return null;
}

export type DevFixtureMode = "fixed" | "random" | null;

/** Mode fixture de développement, d'après DEV_FIXTURE. */
export function devFixtureMode(): DevFixtureMode {
  const v = process.env.DEV_FIXTURE;
  if (v === "true") return "fixed";
  if (v === "random") return "random";
  return null;
}

/**
 * Reroll (DEV_FIXTURE=random) : régénère un itinéraire aléatoire pour
 * aujourd'hui, remplace le défi du jour et efface les parties du jour
 * (propositions comprises) pour pouvoir rejouer le nouvel itinéraire.
 */
export async function rerollTodayChallenge(): Promise<ChallengeWithCities | null> {
  const date = challengeDateFromKey(parisDateKey());
  const pick = await pickRandomChallenge();
  if (!pick) {
    console.error(
      "DEV_FIXTURE=random : aucune paire origine/destination disponible (villes en base ?).",
    );
    return null;
  }
  const journeyPayload = pick.journey as unknown as Prisma.InputJsonValue;
  const data = {
    originCityId: pick.originCityId,
    destCityId: pick.destCityId,
    journey: journeyPayload,
    totalDurationMin: pick.journey.totalDurationMin,
  };

  const sessions = await db.gameSession.findMany({
    where: { challengeDate: date },
    select: { id: true },
  });
  if (sessions.length > 0) {
    await db.guess.deleteMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
    });
  }
  await db.gameSession.deleteMany({ where: { challengeDate: date } });

  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: { challengeDate: date, ...data },
    update: data,
  });

  return db.dailyChallenge.findUnique({
    where: { challengeDate: date },
    include: { originCity: true, destinationCity: true },
  });
}

/** Charge un itinéraire aléatoire en défi du jour (DEV_FIXTURE=random). */
async function seedRandomChallenge(date: Date): Promise<ChallengeWithCities | null> {
  const pick = await pickRandomChallenge();
  if (!pick) {
    console.error(
      "DEV_FIXTURE=random : génération impossible (villes en base ? lancer npm run prepare:data && npm run data:import).",
    );
    return null;
  }
  const journeyPayload = pick.journey as unknown as Prisma.InputJsonValue;
  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: {
      challengeDate: date,
      originCityId: pick.originCityId,
      destCityId: pick.destCityId,
      journey: journeyPayload,
      totalDurationMin: pick.journey.totalDurationMin,
    },
    update: {},
  });
  return db.dailyChallenge.findUnique({
    where: { challengeDate: date },
    include: { originCity: true, destinationCity: true },
  });
}

/**
 * Repli du cron M2 (spécification §6.5) : charge le fixture figé
 * data/fixtures/demo-journey.json comme défi du jour quand la génération
 * réelle échoue (API indisponible) — plutôt que de laisser le jour sans défi.
 */
export async function fallbackToFixtureChallenge(
  date: Date,
): Promise<ChallengeWithCities | null> {
  return seedFixtureChallenge(date);
}

/**
 * Charge data/fixtures/demo-journey.json en défi du jour. Tolérant : si un
 * identifiant GeoNames manque en base (cities.europe.json non régénéré,
 * homonymie), repli sur une résolution par nom de ville.
 */
async function seedFixtureChallenge(date: Date): Promise<ChallengeWithCities | null> {
  const fixture = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "data", "fixtures", "demo-journey.json"),
      "utf8",
    ),
  ) as DailyJourney;

  const first = fixture.segments[0];
  const last = fixture.segments[fixture.segments.length - 1];
  const [origin, dest] = await Promise.all([
    resolveCity(fixture.originCityId, first?.from ?? ""),
    resolveCity(fixture.destCityId, last?.to ?? ""),
  ]);

  if (!origin || !dest) {
    console.error(
      "DEV_FIXTURE : villes du fixture introuvables en base (originCityId=" +
      fixture.originCityId +
      ", destCityId=" +
      fixture.destCityId +
      "). Lancer npm run prepare:cities && npm run data:import.",
    );
    return null;
  }
  if (!origin.hasTrainStation) {
    console.error("DEV_FIXTURE : la ville de départ n'a pas de gare (§1.1).");
    return null;
  }

  // Nettoyage des correspondances de bordure (1–2 min) aussi sur le fixture.
  const cleanedSegments = mergeEdgeConnections(fixture.segments);
  const journey: Journey = {
    totalDurationMin: cleanedSegments.reduce((a, s) => a + s.durationMin, 0),
    segments: cleanedSegments,
  };
  const journeyPayload = journey as unknown as Prisma.InputJsonValue;

  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: {
      challengeDate: date,
      originCityId: origin.id,
      destCityId: dest.id,
      journey: journeyPayload,
      totalDurationMin: fixture.totalDurationMin,
    },
    update: {},
  });

  return db.dailyChallenge.findUnique({
    where: { challengeDate: date },
    include: { originCity: true, destinationCity: true },
  });
}

/** Résout une ville par id GeoNames, puis par nom (cas signalé au demo/README). */
async function resolveCity(id: string, nameHint: string) {
  const byId = await db.city.findUnique({ where: { id } });
  if (byId) return byId;
  const base = nameHint.split(/[\s-]/)[0] ?? "";
  if (!base) return null;
  return db.city.findFirst({
    where: { name: base },
    orderBy: { population: "desc" },
  });
}
