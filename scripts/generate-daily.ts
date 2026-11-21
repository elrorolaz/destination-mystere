// Génère le défi du jour (ou d'une date donnée) en ligne de commande —
// même code que le cron /api/cron/generate-daily (M2, spécification §6).
//
//   npm run challenge:generate                          # aujourd'hui (Paris)
//   npm run challenge:generate -- --date 2026-11-22     # une date précise
//   npm run challenge:generate -- --force               # regénère même si existant
//
// Sans SNCF_API_TOKEN, les tronçons rail passent en estimation paramétrique
// (le vol reste estimé §5.2) ; en cas d'échec total, repli sur le fixture figé.

import { challengeDateFromKey, parisDateKey } from "../src/lib/paris-date.ts";
import { db } from "../src/lib/db.ts";
import {
  generateDailyChallenge,
  upsertDailyChallenge,
} from "../src/server/daily-challenge.ts";
import { fallbackToFixtureChallenge } from "../src/server/challenge-store.ts";

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf("--date");
  const dateKey =
    dateIdx >= 0 && args[dateIdx + 1] && /^\d{4}-\d{2}-\d{2}$/.test(args[dateIdx + 1]!)
      ? args[dateIdx + 1]!
      : parisDateKey();
  const force = args.includes("--force");

  const date = challengeDateFromKey(dateKey);
  const existing = await db.dailyChallenge.findUnique({ where: { challengeDate: date } });
  if (existing && !force) {
    console.log(
      "Défi " + dateKey + " déjà présent (origine=" +
        (await db.city.findUnique({ where: { id: existing.originCityId } }))?.name +
        "), rien à faire. --force pour regénérer.",
    );
    return;
  }

  try {
    const challenge = await generateDailyChallenge(dateKey);
    await upsertDailyChallenge(challenge, date);
    console.log(
      "✅ Défi " + dateKey + " généré [" + challenge.source + ", zone " + challenge.zone + "] : " +
        challenge.segments.length + " segments, " + challenge.totalDurationMin + " min.",
    );
    for (const s of challenge.segments) {
      console.log(
        "   " + s.index + ". " + s.kind + "  " + s.from + " → " + s.to +
          (s.lineOrCarrier ? "  [" + s.lineOrCarrier + "]" : "") +
          "  " + s.durationMin + " min",
      );
    }
  } catch (err) {
    console.error("⚠️  Génération impossible (" + (err as Error).message + "), repli sur le fixture.");
    const fallback = await fallbackToFixtureChallenge(date);
    if (!fallback) {
      console.error("Repli impossible : aucune ville du fixture en base ?");
      process.exitCode = 1;
      return;
    }
    console.log(
      "✅ Défi " + dateKey + " en repli (fixture) : " + fallback.originCity.name +
        " → " + fallback.destinationCity.name + ", " + fallback.totalDurationMin + " min.",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
