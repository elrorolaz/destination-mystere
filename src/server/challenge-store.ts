// Défi du jour : lecture en base, et chargement du fixture de démonstration
// quand aucun défi n'existe et que DEV_FIXTURE=true (chemin déterministe
// décrit au README, § « Premier test »). La génération quotidienne réelle
// arrive avec M2 (cron + PRNG + clients SNCF/vols).

import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "../lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../lib/paris-date.ts";
import type { DailyJourney, Journey } from "./routing/types.ts";

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
  if (process.env.DEV_FIXTURE !== "true") return null;
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

  const journey: Journey = {
    totalDurationMin: fixture.totalDurationMin,
    segments: fixture.segments,
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
