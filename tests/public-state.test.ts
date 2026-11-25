// État public du jeu (§7 anti-triche) — M3+ (match en 3 itinéraires).
// La fonction buildPublicState est pure : c'est LE garde-fou qui empêche la
// destination et le journey d'une manche de fuiter vers le client avant sa
// fin — y compris pour les manches pas encore commencées (PENDING).

import { describe, expect, it } from "vitest";
import type { Journey } from "../src/server/routing/types.ts";
import {
  buildPublicState,
  type ChallengeInput,
  type GuessInput,
  type MatchRouteInput,
} from "../src/server/game-service.ts";
import { ROUTE_COUNT } from "../src/lib/game-types.ts";

const origin = { id: "2984114", name: "Reims", country: "FR", lat: 49.2583, lng: 4.0317 };
const vienna = { id: "2761369", name: "Vienne", country: "AT", lat: 48.2082, lng: 16.3738 };
const bethune = { id: "580032", name: "Béthune", country: "FR", lat: 50.5302, lng: 2.6452 };
const lyon = { id: "2996944", name: "Lyon", country: "FR", lat: 45.764, lng: 4.8357 };
const barcelona = { id: "3128760", name: "Barcelone", country: "ES", lat: 41.3851, lng: 2.1734 };
const strasbourg = { id: "2973891", name: "Strasbourg", country: "FR", lat: 48.5734, lng: 7.7521 };
const munich = { id: "2867714", name: "Munich", country: "DE", lat: 48.1351, lng: 11.582 };

const journey: Journey = {
  totalDurationMin: 325,
  segments: [
    { index: 1, kind: "rail", modeDetail: "TGV", lineOrCarrier: "TGV inOui", durationMin: 46, from: "Reims-Centre", to: "Paris-Est" },
    { index: 2, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 12, from: "Paris-Est", to: "Gare de l'Est" },
    { index: 3, kind: "urban", modeDetail: "Métro", lineOrCarrier: "Métro ligne 5", durationMin: 4, from: "Gare de l'Est", to: "Gare du Nord" },
    { index: 4, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 5, from: "Gare du Nord", to: "Gare du Nord (RER)" },
    { index: 5, kind: "urban", modeDetail: "RER", lineOrCarrier: "RER B", durationMin: 34, from: "Gare du Nord (RER)", to: "Aéroport CDG 2", intermediateStops: ["Aulnay-sous-Bois"] },
    { index: 6, kind: "connection", modeDetail: "Enregistrement et embarquement", lineOrCarrier: "", durationMin: 75, from: "Aéroport CDG 2", to: "Paris-CDG" },
    { index: 7, kind: "air", modeDetail: "Avion", lineOrCarrier: "Air France", durationMin: 110, from: "Paris-CDG", to: "Vienne-Schwechat" },
    { index: 8, kind: "connection", modeDetail: "Correspondance", lineOrCarrier: "", durationMin: 12, from: "Vienne-Schwechat", to: "Flughafen Wien" },
    { index: 9, kind: "rail", modeDetail: "S-Bahn", lineOrCarrier: "S-Bahn S7 (ÖBB)", durationMin: 27, from: "Flughafen Wien", to: "Wien Mitte", intermediateStops: ["Wien Praterstern"] },
  ],
};

const journey2: Journey = {
  totalDurationMin: 180,
  segments: [
    { index: 1, kind: "rail", modeDetail: "TGV", lineOrCarrier: "TGV inOui", durationMin: 180, from: "Lyon-Part-Dieu", to: "Barcelone-Sants" },
  ],
};

const journey3: Journey = {
  totalDurationMin: 95,
  segments: [
    { index: 1, kind: "rail", modeDetail: "TER", lineOrCarrier: "TER Grand Est", durationMin: 95, from: "Strasbourg", to: "Munich" },
  ],
};

function routeInput(
  routeIndex: number,
  o: typeof origin,
  d: typeof vienna,
  j: Journey,
): ChallengeInput & { routeIndex: number } {
  return {
    routeIndex,
    journey: j,
    totalDurationMin: j.totalDurationMin,
    originCity: o,
    destinationCity: d,
    originCityId: o.id,
    destCityId: d.id,
  };
}

const route1 = routeInput(1, origin, vienna, journey);
const route2 = routeInput(2, lyon, barcelona, journey2);
const route3 = routeInput(3, strasbourg, munich, journey3);

const wrongGuess = (n: number): GuessInput => ({
  attemptNumber: n,
  snappedCity: bethune,
  correct: false,
});

/** Construit un match de 3 manches à partir des états de manches fournis. */
function match(
  s1: MatchRouteInput["session"],
  g1: GuessInput[],
  s2: MatchRouteInput["session"] = null,
  g2: GuessInput[] = [],
  s3: MatchRouteInput["session"] = null,
  g3: GuessInput[] = [],
  currentRouteIndex = 1,
) {
  const routes: MatchRouteInput[] = [
    { index: 1, route: route1, session: s1, guesses: g1 },
    { index: 2, route: route2, session: s2, guesses: g2 },
    { index: 3, route: route3, session: s3, guesses: g3 },
  ];
  return buildPublicState("2026-11-16", routes, currentRouteIndex);
}

describe("buildPublicState — anti-triche, une manche à la fois", () => {
  it("masque destination et journey de la manche tant qu'elle est ACTIVE", () => {
    const state = match(
      { status: "ACTIVE", attemptCount: 2, score: 0 },
      [wrongGuess(1), wrongGuess(2)],
    );
    expect(state.status).toBe("ACTIVE");
    expect(state.destination).toBeNull();
    expect(state.journey).toBeNull();
    expect(state.routeIndex).toBe(1);
    expect(state.routeCount).toBe(ROUTE_COUNT);
    // Le point de départ de la manche courante, lui, est public.
    expect(state.origin.name).toBe("Reims");
  });

  it("ne fait fuiter AUCUNE destination des autres itinéraires (manches PENDING ou ACTIVE)", () => {
    // Manche 1 active, manches 2 (active aussi, en théorie) et 3 pas commencée.
    const state = match(
      { status: "ACTIVE", attemptCount: 1, score: 0 },
      [wrongGuess(1)],
      { status: "ACTIVE", attemptCount: 0, score: 0 },
      [],
      null,
      [],
      2,
    );
    const json = JSON.stringify(state);
    expect(json).not.toContain("Vienne");
    expect(json).not.toContain("Barcelone");
    expect(json).not.toContain("Munich");
    expect(json).not.toContain("2761369");
    expect(json).not.toContain("3128760");
    expect(json).not.toContain("2867714");
    // Seul le départ de la manche courante est visible.
    expect(state.origin.name).toBe("Lyon");
    expect(state.routeResults[2]!.status).toBe("PENDING");
    expect(state.routeResults[2]!.destination).toBeNull();
  });

  it("sert exactement les indices A et B après deux échecs", () => {
    const state = match(
      { status: "ACTIVE", attemptCount: 2, score: 0 },
      [wrongGuess(1), wrongGuess(2)],
    );
    expect(state.hints.map((h) => h.key)).toEqual(["A", "B"]);
  });

  it("révèle destination et journey sur une manche gagnée, et expose totalScore", () => {
    const state = match(
      { status: "WON", attemptCount: 3, score: 700 },
      [
        wrongGuess(1),
        wrongGuess(2),
        { attemptNumber: 3, snappedCity: vienna, correct: true },
      ],
    );
    expect(state.destination?.name).toBe("Vienne");
    expect(state.journey?.segments).toHaveLength(9);
    expect(state.score).toBe(700);
    // Manche gagnée → révélée dans routeResults ; total = 700 (seule manche finie).
    expect(state.routeResults[0]!.destination?.name).toBe("Vienne");
    expect(state.routeResults[0]!.origin?.name).toBe("Reims");
    expect(state.routeResults[0]!.lastDistanceKm).toBe(0); // essai gagnant à 0 km
    expect(state.routeResults[1]!.status).toBe("PENDING");
    expect(state.routeResults[1]!.destination).toBeNull();
    expect(state.totalScore).toBe(700);
    expect(state.matchFinished).toBe(false);
  });

  it("affiche la distance au but par proposition et publie le journey après un échec", () => {
    const state = match(
      { status: "LOST", attemptCount: 6, score: 0 },
      [1, 2, 3, 4, 5, 6].map((n) => wrongGuess(n)),
    );
    // Béthune → Vienne : ~1 030 km orthodromiques.
    expect(state.guesses[0]!.distanceKm).toBeGreaterThan(900);
    expect(state.journey).not.toBeNull();
    expect(state.journey?.totalDurationMin).toBe(325);
    // Six échecs → indices A à D uniquement (les essais 5 et 6 n'en ajoutent pas).
    expect(state.hints.map((h) => h.key)).toEqual(["A", "B", "C", "D"]);
    // Manche perdue : lastDistanceKm = distance du dernier essai.
    expect(state.routeResults[0]!.lastDistanceKm).toBeGreaterThan(900);
  });

  it("match terminé : les 3 manches sont révélées, totalScore = somme, matchFinished", () => {
    const state = match(
      { status: "WON", attemptCount: 1, score: 1000 },
      [{ attemptNumber: 1, snappedCity: vienna, correct: true }],
      { status: "LOST", attemptCount: 6, score: 42 },
      [1, 2, 3, 4, 5, 6].map((n) => wrongGuess(n)),
      { status: "WON", attemptCount: 4, score: 550 },
      [wrongGuess(1), wrongGuess(2), wrongGuess(3), { attemptNumber: 4, snappedCity: munich, correct: true }],
      3,
    );
    expect(state.matchFinished).toBe(true);
    expect(state.totalScore).toBe(1000 + 42 + 550);
    expect(state.routeResults.map((r) => r.status)).toEqual(["WON", "LOST", "WON"]);
    expect(state.routeResults.map((r) => r.destination?.name)).toEqual([
      "Vienne",
      "Barcelone",
      "Munich",
    ]);
    expect(state.routeResults.map((r) => r.origin?.name)).toEqual([
      "Reims",
      "Lyon",
      "Strasbourg",
    ]);
    // Dernière manche courante = la 3e, révélée aussi en « destination ».
    expect(state.destination?.name).toBe("Munich");
  });
});
