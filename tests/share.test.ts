// Texte de partage du résultat final (buildShareText) — anti-spoiler :
// le texte partagé ne doit contenir AUCUN itinéraire (ni nom de ville de
// départ/destination, ni détail de trajet), seulement date + carrés + points.

import { describe, expect, it } from "vitest";
import type { Journey } from "../src/server/routing/types.ts";
import {
  buildPublicState,
  type ChallengeInput,
  type GuessInput,
  type MatchRouteInput,
} from "../src/server/game-service.ts";
import { buildShareText } from "../src/lib/format/share.ts";

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
    { index: 2, kind: "air", modeDetail: "Avion", lineOrCarrier: "Air France", durationMin: 110, from: "Paris-CDG", to: "Vienne-Schwechat" },
  ],
};

function routeInput(
  routeIndex: number,
  o: typeof origin,
  d: typeof vienna,
): ChallengeInput & { routeIndex: number } {
  return {
    routeIndex,
    journey,
    totalDurationMin: journey.totalDurationMin,
    originCity: o,
    destinationCity: d,
    originCityId: o.id,
    destCityId: d.id,
  };
}

const wrongGuess = (n: number): GuessInput => ({
  attemptNumber: n,
  snappedCity: bethune,
  correct: false,
});

// Match terminé : manche 1 gagnée au 2e essai, manches 2 et 3 perdues.
const routes: MatchRouteInput[] = [
  {
    index: 1,
    route: routeInput(1, origin, vienna),
    session: { status: "WON", attemptCount: 2, score: 1700 },
    guesses: [wrongGuess(1), { attemptNumber: 2, snappedCity: vienna, correct: true }],
  },
  {
    index: 2,
    route: routeInput(2, lyon, barcelona),
    session: { status: "LOST", attemptCount: 6, score: 188 },
    guesses: [1, 2, 3, 4, 5, 6].map((n) => wrongGuess(n)),
  },
  {
    index: 3,
    route: routeInput(3, strasbourg, munich),
    session: { status: "LOST", attemptCount: 6, score: 94 },
    guesses: [1, 2, 3, 4, 5, 6].map((n) => wrongGuess(n)),
  },
];

const state = buildPublicState("2026-11-16", routes, 3);

describe("buildShareText — partage du résultat sans spoiler", () => {
  it("contient la date, les carrés de chaque itinéraire, les points et le total", () => {
    const text = buildShareText(state);
    expect(text).toContain("2026-11-16");
    expect(text).toContain("Itinéraire 1 : 🟥🟩 — 1700 pts");
    expect(text).toContain("Itinéraire 2 : 🟥🟥🟥🟥🟥🟥 — 188 pts");
    expect(text).toContain("Itinéraire 3 : 🟥🟥🟥🟥🟥🟥 — 94 pts");
    expect(text).toContain("Score total : 1982 pts");
  });

  it("ne contient AUCUN nom de ville (départ, destination, essai) ni aucun détail d'itinéraire", () => {
    const text = buildShareText(state);
    for (const name of [
      "Reims",
      "Vienne",
      "Lyon",
      "Barcelone",
      "Strasbourg",
      "Munich",
      "Béthune",
      "Reims-Centre",
      "Paris-Est",
      "Vienne-Schwechat",
      "TGV inOui",
      "Air France",
      "2761369",
      "3128760",
    ]) {
      expect(text).not.toContain(name);
    }
    // Ni le mot « itinéraire » au sens trajet : seules les lignes numérotées.
    expect(text).not.toContain("→");
  });

  it("le texte reste sans spoiler même au niveau JSON de l'état complet", () => {
    const text = buildShareText(state);
    // Aucune coordonnée, aucun id de ville.
    expect(text).not.toMatch(/\d+\.\d{3,}/); // coordonnées
    const allNames = [
      ...routes.map((r) => r.route!.destinationCity.name),
      ...routes.map((r) => r.route!.originCity.name),
      ...routes.flatMap((r) => r.guesses.map((g) => g.snappedCity.name)),
    ];
    for (const name of allNames) expect(text).not.toContain(name);
  });
});
