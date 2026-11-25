// Génère les TROIS itinéraires du jour (ou d'une date donnée) en ligne de
// commande — même code que le cron /api/cron/generate-daily (M2+, §6).
//
//   npm run challenge:generate                          # aujourd'hui (Paris)
//   npm run challenge:generate -- --date 2026-11-22     # une date précise
//   npm run challenge:generate -- --force               # regénère même si existant
//
// Sans SNCF_API_TOKEN, les tronçons rail passent en estimation paramétrique
// (le vol reste estimé §5.2) ; en cas d'échec total, repli sur le fixture figé.

import { challengeDateFromKey, parisDateKey } from "../src/lib/paris-date.ts";
import { db } from "../src/lib/db.ts";
import { ROUTE_COUNT } from "../src/lib/game-types.ts";
import {
  excludedPairs,
  generateRouteForSlot,
  getRoute,
} from "../src/server/challenge-store.ts";
import { generateDailyChallenge, upsertDailyRoute } from "../src/server/daily-challenge.ts";

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf("--date");
  const dateKey =
    dateIdx >= 0 && args[dateIdx + 1] && /^\d{4}-\d{2}-\d{2}$/.test(args[dateIdx + 1]!)
      ? args[dateIdx + 1]!
      : parisDateKey();
  const force = args.includes("--force");

  const date = challengeDateFromKey(dateKey);
  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: { challengeDate: date },
    update: {},
  });

  for (let slot = 1; slot <= ROUTE_COUNT; slot++) {
    const existing = await getRoute(date, slot);
    if (existing && !force) {
      console.log(
        "Itinéraire " + slot + " " + dateKey + " déjà présent (origine=" +
          existing.originCity.name + "), rien à faire. --force pour regénérer.",
      );
      continue;
    }
    if (force && existing) {
      await db.dailyRoute.delete({
        where: { challengeDate_routeIndex: { challengeDate: date, routeIndex: slot } },
      });
    }

    // Hors DEV_FIXTURE, on passe par le générateur déterministe seedé par
    // slot (les 3 itinéraires du jour sont distincts : paires exclues).
    const exclude = await excludedPairs(date);
    try {
      const challenge = await generateDailyChallenge(dateKey, { slot, exclude });
      await upsertDailyRoute(challenge, date);
      console.log(
        "✅ Itinéraire " + slot + " " + dateKey + " généré [" + challenge.source + ", zone " +
          challenge.zone + "] : " + challenge.segments.length + " segments, " +
          challenge.totalDurationMin + " min.",
      );
      for (const s of challenge.segments) {
        console.log(
          "   " + s.index + ". " + s.kind + "  " + s.from + " → " + s.to +
            (s.lineOrCarrier ? "  [" + s.lineOrCarrier + "]" : "") +
            "  " + s.durationMin + " min",
        );
      }
    } catch (err) {
      console.error(
        "⚠️  Génération de l'itinéraire " + slot + " impossible (" + (err as Error).message +
          "), repli sur le fixture.",
      );
      const fallback = await generateRouteForSlot(date, dateKey, slot);
      if (!fallback) {
        console.error("Repli impossible : aucune ville du fixture en base ?");
        process.exitCode = 1;
        continue;
      }
      console.log(
        "✅ Itinéraire " + slot + " " + dateKey + " en repli (fixture) : " +
          fallback.originCity.name + " → " + fallback.destinationCity.name + ", " +
          fallback.totalDurationMin + " min.",
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
