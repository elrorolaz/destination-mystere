// Migration des données existantes vers le modèle « match en 3 itinéraires »
// (DailyRoute + RouteSession) — SANS RIEN SUPPRIMER :
//   - chaque DailyChallenge existant devient la DailyRoute d'index 1 ;
//   - chaque GameSession existante garde son id et reçoit currentRouteIndex=1,
//     totalScore = score si la partie était terminée, et une RouteSession
//     d'index 1 portant status/attemptCount/score ;
//   - chaque Guess est rattachée à la RouteSession correspondante
//     (routeSessionId), l'ancien sessionId étant conservé (colonne dépréciée).
//
// Relance idempotente : ne touche que ce qui n'est pas encore migré.

import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.ts";

async function main() {
  // 1) DailyChallenge → DailyRoute (index 1)
  const oldChallenges = await db.dailyChallenge.findMany({
    where: { originCityId: { not: null } },
  });
  for (const c of oldChallenges) {
    if (!c.originCityId || !c.destCityId || !c.journey || c.totalDurationMin === null) continue;
    const exists = await db.dailyRoute.findUnique({
      where: { challengeDate_routeIndex: { challengeDate: c.challengeDate, routeIndex: 1 } },
    });
    if (exists) continue;
    await db.dailyRoute.create({
      data: {
        challengeDate: c.challengeDate,
        routeIndex: 1,
        originCityId: c.originCityId,
        destCityId: c.destCityId,
        journey: c.journey as Prisma.InputJsonValue,
        totalDurationMin: c.totalDurationMin,
        generatedAt: c.generatedAt,
      },
    });
    console.log("DailyRoute 1 créée pour " + c.challengeDate.toISOString().slice(0, 10));
  }

  // 2) GameSession → RouteSession (index 1) + totalScore
  const sessions = await db.gameSession.findMany();
  for (const s of sessions) {
    const rs = await db.routeSession.findUnique({
      where: { sessionId_routeIndex: { sessionId: s.id, routeIndex: 1 } },
    });
    if (!rs) {
      await db.routeSession.create({
        data: {
          id: "rs_" + s.id,
          sessionId: s.id,
          routeIndex: 1,
          status: s.status,
          attemptCount: s.attemptCount ?? 0,
          score: s.score ?? 0,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
        },
      });
      console.log("RouteSession créée pour la session " + s.id.slice(0, 8));
    }
    const finished = s.status !== "ACTIVE";
    await db.gameSession.update({
      where: { id: s.id },
      data: {
        currentRouteIndex: 1,
        totalScore: finished ? (s.score ?? 0) : 0,
        status: finished ? "DONE" : "ACTIVE",
      },
    });
    // 3) Guess → routeSessionId (idempotent : même valeur réécrite)
    await db.guess.updateMany({
      where: { sessionId: s.id },
      data: { routeSessionId: "rs_" + s.id },
    });
  }
  console.log("Migration terminée : " + oldChallenges.length + " défi(s), " + sessions.length + " session(s).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
