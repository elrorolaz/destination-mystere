// Test d'intégration local de GET /api/route-geometry (M3+ design, match en
// 3 itinéraires) : quand Overpass est indisponible (railPath →
// followsTracks=false), la route doit se replier sur la géométrie réelle du
// leg rejoué auprès du routeur (MOTIS legGeometry) — et non renvoyer une
// simple ligne droite. + contrôle d'accès : une manche ACTIVE → 403, et
// ?all=1 ne renvoie les 3 itinéraires que si le match est terminé.
//
// Tout est mocké (Prisma, cookies, Overpass, routeur) : aucun réseau.

import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// --- Mocks des dépendances externes de la route ---

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dm_guest" ? { value: "guest-test" } : undefined),
  }),
}));

// Manche 1 terminée (LOST) ; manches 2 et 3 selon le scénario du test.
let routeSessionRows: Array<{ routeIndex: number; status: string }> = [
  { routeIndex: 1, status: "LOST" },
];

vi.mock("../src/lib/db.ts", () => ({
  db: {
    gameSession: {
      findUnique: async () => ({ id: "s1", currentRouteIndex: 1 }),
    },
    routeSession: {
      findMany: async () => routeSessionRows,
    },
  },
}));

const journey1 = {
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
      fromCoord: [45.764, 4.8357],
      toCoord: [46.3064, 4.8289],
      startTime: "2026-05-20T09:00:00Z",
    },
  ],
};

const journey2 = {
  totalDurationMin: 60,
  segments: [
    {
      index: 0,
      kind: "rail",
      modeDetail: "TER",
      lineOrCarrier: "TER",
      durationMin: 60,
      from: "Lyon",
      to: "Grenoble",
      fromCoord: [45.764, 4.8357],
      toCoord: [45.1885, 5.7245],
      startTime: "2026-05-20T10:00:00Z",
    },
  ],
};

const journey3 = {
  totalDurationMin: 80,
  segments: [
    {
      index: 0,
      kind: "rail",
      modeDetail: "TGV",
      lineOrCarrier: "TGV",
      durationMin: 80,
      from: "Paris",
      to: "Lille",
      fromCoord: [48.8566, 2.3522],
      toCoord: [50.6292, 3.0573],
      startTime: "2026-05-20T11:00:00Z",
    },
  ],
};

vi.mock("../src/server/challenge-store.ts", () => ({
  getRoute: async (_date: unknown, slot: number) => {
    const journeys = [journey1, journey2, journey3];
    const j = journeys[slot - 1];
    return j ? { routeIndex: slot, journey: j } : null;
  },
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

function reqOf(query = ""): NextRequest {
  return {
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as unknown as NextRequest;
}

describe("GET /api/route-geometry — repli sur la géométrie réelle du leg (Overpass bloqué)", () => {
  it("renvoie followsTracks=true et la géométrie du leg quand Overpass est indisponible", async () => {
    routeSessionRows = [{ routeIndex: 1, status: "LOST" }];
    const res = await GET(reqOf());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      traces: Array<{
        index: number;
        kind: string;
        routeIndex?: number;
        followsTracks: boolean;
        geometry: [number, number][];
      }>;
    };
    expect(json.traces).toHaveLength(3);
    expect(json.traces.every((t) => t.routeIndex === 1)).toBe(true);

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

  it("403 tant que la manche demandée est ACTIVE (anti-fuite §7)", async () => {
    routeSessionRows = [{ routeIndex: 1, status: "ACTIVE" }];
    const res = await GET(reqOf("route=1"));
    expect(res.status).toBe(403);
  });

  it("?all=1 renvoie les 3 itinéraires (avec routeIndex) seulement si le match est terminé", async () => {
    // Match pas terminé : manches 2 et 3 non terminées → 403.
    routeSessionRows = [
      { routeIndex: 1, status: "LOST" },
      { routeIndex: 2, status: "ACTIVE" },
    ];
    const res403 = await GET(reqOf("all=1"));
    expect(res403.status).toBe(403);

    // Match terminé : les 3 manches finies → 3 itinéraires tracés.
    routeSessionRows = [
      { routeIndex: 1, status: "WON" },
      { routeIndex: 2, status: "LOST" },
      { routeIndex: 3, status: "WON" },
    ];
    const res = await GET(reqOf("all=1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      traces: Array<{ index: number; routeIndex?: number; geometry: [number, number][] }>;
    };
    const routes = new Set(json.traces.map((t) => t.routeIndex ?? 1));
    expect(routes).toEqual(new Set([1, 2, 3]));
    // 3 + 1 + 1 segments = 5 tracés au total.
    expect(json.traces).toHaveLength(5);
  });

  it("?route=2 renvoie uniquement l'itinéraire 2 s'il est terminé", async () => {
    routeSessionRows = [
      { routeIndex: 1, status: "LOST" },
      { routeIndex: 2, status: "WON" },
    ];
    const res = await GET(reqOf("route=2"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      traces: Array<{ routeIndex?: number }>;
    };
    expect(json.traces).toHaveLength(1);
    expect(json.traces[0]!.routeIndex).toBe(2);
  });
});
