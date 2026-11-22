// Test d'intégration local de GET /api/route-geometry (M3+ design) :
// quand Overpass est indisponible (railPath → followsTracks=false), la route
// doit se replier sur la géométrie réelle du leg rejoué auprès du routeur
// (MOTIS legGeometry) — et non renvoyer une simple ligne droite.
//
// Tout est mocké (Prisma, cookies, Overpass, routeur) : aucun réseau.

import { describe, expect, it, vi } from "vitest";

// --- Mocks des dépendances externes de la route ---

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dm_guest" ? { value: "guest-test" } : undefined),
  }),
}));

vi.mock("../src/lib/db.ts", () => ({
  db: {
    gameSession: {
      findUnique: async () => ({ status: "LOST" }), // partie terminée → tracé autorisé
    },
  },
}));

vi.mock("../src/server/challenge-store.ts", () => ({
  getTodayChallenge: async () => ({
    journey: {
      totalDurationMin: 100,
      segments: [
        {
          index: 0,
          kind: "rail",
          modeDetail: "TGV",
          lineOrCarrier: "TGV INOUI",
          durationMin: 45,
          from: "Reims",
          to: "Paris Est",
          fromCoord: [49.2583, 4.0317],
          toCoord: [48.8566, 2.3522],
          startTime: "2026-05-20T06:30:00Z",
        },
        {
          index: 1,
          kind: "air",
          modeDetail: "Avion",
          lineOrCarrier: "Air France",
          durationMin: 55,
          from: "Paris CDG",
          to: "Vienne",
          fromCoord: [49.0097, 2.5479],
          toCoord: [48.1103, 16.5697],
        },
        {
          index: 2,
          kind: "rail",
          modeDetail: "TER",
          lineOrCarrier: "TER",
          durationMin: 60,
          from: "Lyon",
          to: "Mâcon",
          fromCoord: [45.7640, 4.8357],
          toCoord: [46.3064, 4.8289],
          startTime: "2026-05-20T09:00:00Z",
        },
      ],
    },
  }),
}));

// Overpass indisponible : railPath retombe en ligne droite (followsTracks=false).
vi.mock("../src/server/routing/rail-geometry.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/server/routing/rail-geometry.ts")>();
  return {
    ...mod,
    railPath: async (from: [number, number], to: [number, number]) => ({
      geometry: [from, to],
      followsTracks: false, // simule Overpass bloqué
    }),
  };
});

// Routeur MOTIS joignable : renvoie un leg avec sa géométrie réelle (5 points).
vi.mock("../src/server/routing/router.ts", () => ({
  defaultRouter: () => ({
    name: "transitous-mock",
    plan: async () => [
      {
        durationMin: 45,
        transfers: 0,
        startTime: "2026-05-20T06:30:00Z",
        endTime: "2026-05-20T07:15:00Z",
        legs: [
          {
            mode: "HIGHSPEED_RAIL",
            kind: "rail",
            modeDetail: "TGV",
            lineOrCarrier: "TGV INOUI",
            from: "Reims",
            to: "Paris Est",
            fromCoord: [49.2583, 4.0317],
            toCoord: [48.8566, 2.3522],
            durationMin: 45,
            startTime: "2026-05-20T06:30:00Z",
            endTime: "2026-05-20T07:15:00Z",
            intermediateStops: ["Champagne-Ardenne TGV"],
            geometry: [
              [49.2583, 4.0317],
              [49.1, 3.9],
              [48.95, 3.3],
              [48.9, 2.8],
              [48.8566, 2.3522],
            ],
          },
        ],
      },
    ],
  }),
}));

import { GET } from "../src/app/api/route-geometry/route.ts";

describe("GET /api/route-geometry — repli sur la géométrie réelle du leg (Overpass bloqué)", () => {
  it("renvoie followsTracks=true et la géométrie du leg quand Overpass est indisponible", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      traces: Array<{ index: number; kind: string; followsTracks: boolean; geometry: [number, number][] }>;
    };
    expect(json.traces).toHaveLength(3);

    const rail = json.traces.find((t) => t.index === 0)!;
    expect(rail.followsTracks).toBe(true); // plus de « tracé indicatif »
    expect(rail.geometry.length).toBeGreaterThan(2); // géométrie réelle, pas une ligne droite
    expect(rail.geometry[0]).toEqual([49.2583, 4.0317]);

    const air = json.traces.find((t) => t.kind === "air")!;
    expect(air.followsTracks).toBe(true);
    expect(air.geometry.length).toBeGreaterThan(2); // arc aérien échantillonné

    // 3e segment : le routeur mock ne couvre pas Lyon→Mâcon → repli LISSE
    // (courbe de Bézier douce, pas une ligne droite à 2 points).
    const repli = json.traces.find((t) => t.index === 2)!;
    expect(repli.followsTracks).toBe(false);
    expect(repli.geometry.length).toBeGreaterThan(10); // courbe échantillonnée
    const mid = repli.geometry[Math.floor(repli.geometry.length / 2)]!;
    // le point médian est décalé de la corde (bombé vers le nord) : ce n'est pas [from, to]
    const latMid = (repli.geometry[0]![0] + repli.geometry[repli.geometry.length - 1]![0]) / 2;
    expect(mid[0]).toBeGreaterThan(latMid);
  });
});
