// Itinéraires du jour : lecture/écriture en base, génération par TROIS
// (ROUTE_COUNT) avec une efficacité « premier proposé, suivants en fond » :
//   - ensureTodayRoute1() garantit l'itinéraire 1 (le génère si besoin) et
//     DÉCLENCHE la génération des itinéraires 2 et 3 en arrière-plan (verrou
//     anti-doublon) pendant que le joueur fait sa première manche ;
//   - waitForRoute(slot) attend la génération en cours puis lit la base
//     (génère à la volée en dernier recours) quand le joueur passe au suivant.
//
// Modes de développement (DEV_FIXTURE) :
//   - DEV_FIXTURE=true   → itinéraire 1 = fixture figé data/fixtures/demo-journey.json,
//                          itinéraires 2-3 = génération déterministe (slot) ou aléatoire ;
//   - DEV_FIXTURE=random → 3 itinéraires aléatoires (bouton 🎲 /api/dev/reroll).

import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "../lib/db.ts";
import { challengeDateFromKey, parisDateKey } from "../lib/paris-date.ts";
import { ROUTE_COUNT } from "../lib/game-types.ts";
import type { DailyJourney, Journey } from "./routing/types.ts";
import { mergeEdgeConnections } from "./routing/cleanup.ts";
import { generateDailyChallenge, upsertDailyRoute } from "./daily-challenge.ts";
import { pickRandomChallenge } from "./dev-journey.ts";

export type RouteWithCities = Prisma.DailyRouteGetPayload<{
  include: { originCity: true; destinationCity: true };
}>;

/** Itinéraire `index` (1..ROUTE_COUNT) d'une date. Null : pas encore généré. */
export async function getRoute(date: Date, index: number): Promise<RouteWithCities | null> {
  return db.dailyRoute.findUnique({
    where: { challengeDate_routeIndex: { challengeDate: date, routeIndex: index } },
    include: { originCity: true, destinationCity: true },
  });
}

/** Itinéraires déjà générés pour aujourd'hui (triés par index). */
export async function getTodayRoutes(): Promise<RouteWithCities[]> {
  const date = challengeDateFromKey(parisDateKey());
  return db.dailyRoute.findMany({
    where: { challengeDate: date },
    include: { originCity: true, destinationCity: true },
    orderBy: { routeIndex: "asc" },
  });
}

/** Paires « originId>destId » déjà prises par les itinéraires du jour. */
export async function excludedPairs(date: Date): Promise<Set<string>> {
  const routes = await db.dailyRoute.findMany({
    where: { challengeDate: date },
    select: { originCityId: true, destCityId: true },
  });
  return new Set(routes.map((r) => r.originCityId + ">" + r.destCityId));
}

/* ---------- Génération en fond (verrous anti-doublon) ---------- */

const inflight = new Map<string, Promise<RouteWithCities | null>>();
const bgKey = (dateKey: string, slot: number): string => dateKey + "#" + slot;

/**
 * Déclenche (sans attendre) la génération des itinéraires 2..ROUTE_COUNT
 * manquants pour la date — appelé dès que l'itinéraire 1 est servi, pour
 * qu'ils soient prêts quand le joueur passera à la manche suivante.
 */
export function kickBackgroundRoutes(date: Date, dateKey: string): void {
  for (let slot = 2; slot <= ROUTE_COUNT; slot++) {
    const k = bgKey(dateKey, slot);
    if (inflight.has(k)) continue;
    const p = (async (): Promise<RouteWithCities | null> => {
      try {
        if (!(await getRoute(date, slot))) {
          await generateRouteForSlot(date, dateKey, slot);
        }
        return await getRoute(date, slot);
      } catch (err) {
        console.error("génération en fond " + dateKey + " itinéraire " + slot + " :", err);
        return null;
      } finally {
        inflight.delete(k);
      }
    })();
    inflight.set(k, p);
  }
}

/**
 * Itinéraire `slot` garanti en base : attend une éventuelle génération en
 * fond, lit la base, et génère à la volée en dernier recours.
 */
export async function waitForRoute(
  date: Date,
  dateKey: string,
  slot: number,
): Promise<RouteWithCities | null> {
  if (slot >= 2) {
    const p = inflight.get(bgKey(dateKey, slot));
    if (p) await p.catch(() => undefined);
  }
  const existing = await getRoute(date, slot);
  if (existing) return existing;
  return generateRouteForSlot(date, dateKey, slot);
}

/**
 * Garantit l'itinéraire 1 du jour (généré si absent), déclenche le fond pour
 * les suivants, et le retourne. C'est le point d'entrée du chargement du jeu.
 */
export async function ensureTodayRoute1(): Promise<RouteWithCities | null> {
  const dateKey = parisDateKey();
  const date = challengeDateFromKey(dateKey);
  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: { challengeDate: date },
    update: {},
  });
  let route = await getRoute(date, 1);
  if (!route) route = await generateRouteForSlot(date, dateKey, 1);
  // Les itinéraires 2 et 3 sont générés EN FOND pendant la première manche.
  kickBackgroundRoutes(date, dateKey);
  return route;
}

/* ---------- Génération d'un slot ---------- */

/** Stocke un itinéraire (journey + villes) comme DailyRoute `slot`. */
async function storeRoute(
  date: Date,
  slot: number,
  originCityId: string,
  destCityId: string,
  journey: Journey,
): Promise<void> {
  await db.dailyChallenge.upsert({
    where: { challengeDate: date },
    create: { challengeDate: date },
    update: {},
  });
  const payload = {
    totalDurationMin: journey.totalDurationMin,
    segments: journey.segments,
  } as unknown as Prisma.InputJsonValue;
  await db.dailyRoute.upsert({
    where: { challengeDate_routeIndex: { challengeDate: date, routeIndex: slot } },
    create: {
      challengeDate: date,
      routeIndex: slot,
      originCityId,
      destCityId,
      journey: payload,
      totalDurationMin: journey.totalDurationMin,
    },
    update: {
      originCityId,
      destCityId,
      journey: payload,
      totalDurationMin: journey.totalDurationMin,
    },
  });
}

/**
 * Génère et stocke l'itinéraire `slot` du jour, en excluant les paires déjà
 * prises par les autres itinéraires. Modes : DEV_FIXTURE=random → tirage
 * aléatoire réel ; DEV_FIXTURE=true → slot 1 = fixture figé, suivants =
 * génération déterministe ; sinon génération déterministe seedée par slot.
 * Repli final : fixture figé (§6.5).
 */
export async function generateRouteForSlot(
  date: Date,
  dateKey: string,
  slot: number,
): Promise<RouteWithCities | null> {
  const mode = devFixtureMode();
  const exclude = await excludedPairs(date);

  if (mode === "random") {
    for (let i = 0; i < 6; i++) {
      const pick = await pickRandomChallenge();
      if (!pick) break;
      if (exclude.has(pick.originCityId + ">" + pick.destCityId)) continue;
      await storeRoute(date, slot, pick.originCityId, pick.destCityId, pick.journey);
      return getRoute(date, slot);
    }
    // Dernier recours : accepter une paire déjà prise plutôt que rien.
    const pick = await pickRandomChallenge();
    if (pick) {
      await storeRoute(date, slot, pick.originCityId, pick.destCityId, pick.journey);
      return getRoute(date, slot);
    }
    return null;
  }

  if (mode === "fixed" && slot === 1) return seedFixtureChallenge(date, slot);

  try {
    const challenge = await generateDailyChallenge(dateKey, { slot, exclude });
    await upsertDailyRoute(challenge, date);
    return getRoute(date, slot);
  } catch (err) {
    console.error(
      "génération itinéraire " + slot + " " + dateKey + " : échec, repli (aléatoire puis fixture)",
      err,
    );
    // Repli : d'abord un tirage aléatoire réel (évite de dupliquer le fixture
    // d'un autre slot), puis le fixture figé en dernier recours (§6.5).
    for (let i = 0; i < 8; i++) {
      const pick = await pickRandomChallenge();
      if (!pick) break;
      if (exclude.has(pick.originCityId + ">" + pick.destCityId)) continue;
      await storeRoute(date, slot, pick.originCityId, pick.destCityId, pick.journey);
      return getRoute(date, slot);
    }
    return seedFixtureChallenge(date, slot);
  }
}

/* ---------- Modes fixture de développement ---------- */

export type DevFixtureMode = "fixed" | "random" | null;

/** Mode fixture de développement, d'après DEV_FIXTURE. */
export function devFixtureMode(): DevFixtureMode {
  const v = process.env.DEV_FIXTURE;
  if (v === "true") return "fixed";
  if (v === "random") return "random";
  return null;
}

/**
 * Reroll (DEV_FIXTURE=random) : régénère TROIS itinéraires aléatoires pour
 * aujourd'hui, remplace les itinéraires du jour et efface les parties du jour
 * (manches et propositions) pour pouvoir rejouer les nouveaux itinéraires.
 */
export async function rerollTodayRoutes(): Promise<RouteWithCities[]> {
  const dateKey = parisDateKey();
  const date = challengeDateFromKey(dateKey);

  // Efface parties du jour (propositions → manches → match), puis itinéraires.
  const sessions = await db.gameSession.findMany({
    where: { challengeDate: date },
    select: { id: true },
  });
  if (sessions.length > 0) {
    const routeSessions = await db.routeSession.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: { id: true },
    });
    if (routeSessions.length > 0) {
      await db.guess.deleteMany({
        where: { routeSessionId: { in: routeSessions.map((r) => r.id) } },
      });
    }
    await db.routeSession.deleteMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
    });
  }
  await db.gameSession.deleteMany({ where: { challengeDate: date } });
  await db.dailyRoute.deleteMany({ where: { challengeDate: date } });

  const routes: RouteWithCities[] = [];
  const exclude = new Set<string>();
  for (let slot = 1; slot <= ROUTE_COUNT; slot++) {
    let stored: RouteWithCities | null = null;
    for (let i = 0; i < 6 && !stored; i++) {
      const pick = await pickRandomChallenge();
      if (!pick) break;
      if (exclude.has(pick.originCityId + ">" + pick.destCityId)) continue;
      exclude.add(pick.originCityId + ">" + pick.destCityId);
      await storeRoute(date, slot, pick.originCityId, pick.destCityId, pick.journey);
      stored = await getRoute(date, slot);
    }
    if (stored) routes.push(stored);
  }
  if (routes.length === 0) {
    console.error(
      "DEV_FIXTURE=random : aucune paire origine/destination disponible (villes en base ?).",
    );
  }
  return routes;
}

/**
 * Repli (spécification §6.5) : charge le fixture figé
 * data/fixtures/demo-journey.json comme itinéraire `slot` du jour quand la
 * génération réelle échoue — plutôt que de laisser la manche sans itinéraire.
 */
export async function fallbackToFixtureChallenge(
  date: Date,
  slot = 1,
): Promise<RouteWithCities | null> {
  return seedFixtureChallenge(date, slot);
}

/**
 * Charge data/fixtures/demo-journey.json comme itinéraire `slot` du jour.
 * Tolérant : si un identifiant GeoNames manque en base (cities.europe.json non
 * régénéré, homonymie), repli sur une résolution par nom de ville.
 */
async function seedFixtureChallenge(date: Date, slot: number): Promise<RouteWithCities | null> {
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

  await storeRoute(date, slot, origin.id, dest.id, journey);
  return getRoute(date, slot);
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
