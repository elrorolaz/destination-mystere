// Graphe ferroviaire et géométries de tracé (M3) : fusion des nœuds,
// plus court chemin, simplification, arc aérien.

import { describe, expect, it } from "vitest";
import {
  airArc,
  buildRailGraph,
  pathAlongWays,
  polylineKm,
  simplifyPath,
  type RawWay,
} from "../src/server/routing/rail-geometry.ts";

describe("buildRailGraph", () => {
  it("fusionne les points de géométrie partagés entre voies", () => {
    const ways: RawWay[] = [
      { id: 1, geometry: [[0, 0], [0, 1], [0, 2]] },
      { id: 2, geometry: [[0, 2], [1, 2]] },
      { id: 3, geometry: [[9, 9], [9, 8]] }, // îlot déconnecté
    ];
    const graph = buildRailGraph(ways);
    // 6 nœuds : (0,0) (0,1) (0,2) (1,2) (9,9) (9,8)
    expect(graph.nodes.size).toBe(6);
    // Le nœud partagé (0,2) a exactement deux arêtes.
    expect(graph.adj.get("0.000000|2.000000")).toHaveLength(2);
  });
});

describe("pathAlongWays", () => {
  it("choisit la voie directe plutôt que le détour", () => {
    const withDetour: RawWay[] = [
      { id: 1, geometry: [[0, 0], [0.01, 0]] },
      { id: 2, geometry: [[0.01, 0], [0.06, 0.06], [0.02, 0]] },
      { id: 3, geometry: [[0.01, 0], [0.02, 0]] },
    ];
    expect(pathAlongWays(withDetour, [0, 0], [0.02, 0])).toEqual([
      [0, 0],
      [0.01, 0],
      [0.02, 0],
    ]);
  });

  it("départ = arrivée : chemin de longueur 1", () => {
    const ways: RawWay[] = [{ id: 1, geometry: [[0, 0], [0, 1]] }];
    expect(pathAlongWays(ways, [0, 0], [0, 0])).toEqual([[0, 0]]);
  });
});

describe("simplifyPath (Douglas-Peucker)", () => {
  it("réduit une polyligne collinéaire à ses extrémités", () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [0, 0.5],
      [0, 1],
      [0, 1.5],
      [0, 2],
    ];
    expect(simplifyPath(points, 0.0003)).toEqual([
      [0, 0],
      [0, 2],
    ]);
  });

  it("conserve un point qui s'écarte de la corde", () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [0.5, 0.05],
      [1, 0],
    ];
    expect(simplifyPath(points, 0.0003)).toEqual(points);
  });
});

describe("airArc", () => {
  it("échantillonne un arc exact aux extrémités et bombé vers le nord", () => {
    const arc = airArc([49.0034, 2.571], [48.0663, 16.5626]);
    expect(arc).toHaveLength(49); // steps 48 → 49 points
    expect(arc[0]!).toEqual([49.0034, 2.571]);
    expect(arc[arc.length - 1]!).toEqual([48.0663, 16.5626]);
    const mid = arc[24]!;
    expect(mid[0]).toBeGreaterThan((49.0034 + 48.0663) / 2);
  });
});

describe("polylineKm", () => {
  it("un degré de latitude ≈ 111 km", () => {
    const km = polylineKm([
      [0, 0],
      [0, 1],
    ]);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });
});

describe("smoothArc (repli lisse quand le tracé ferroviaire est indisponible)", () => {
  it("échantillonne steps+1 points entre from et to", async () => {
    const { smoothArc } = await import("../src/server/routing/rail-geometry.ts");
    const g = smoothArc([49.2583, 4.0317], [45.7640, 4.8357], 32, 0.06);
    expect(g).toHaveLength(33);
    expect(g[0]).toEqual([49.2583, 4.0317]);
    expect(g[32]).toEqual([45.7640, 4.8357]);
  });

  it("est bombée vers le nord et plus plate que l'arc aérien", async () => {
    const { smoothArc, airArc } = await import("../src/server/routing/rail-geometry.ts");
    const from: [number, number] = [48.0, 2.0];
    const to: [number, number] = [48.0, 4.0]; // corde est-ouest
    const repli = smoothArc(from, to, 32, 0.06);
    const air = airArc(from, to, 32);
    const midRepli = repli[16]!;
    const midAir = air[16]!;
    // bombée vers le nord : latitude du milieu > latitude de la corde
    expect(midRepli[0]).toBeGreaterThan(48.0);
    expect(midAir[0]).toBeGreaterThan(48.0);
    // le repli (bulge 0,06) est nettement plus plat que l'arc aérien (0,15)
    expect(midRepli[0] - 48.0).toBeLessThan((midAir[0] - 48.0) * 0.6);
  });

  it("airArc = smoothArc avec bulge 0,15 (rétrocompatible)", async () => {
    const { smoothArc, airArc } = await import("../src/server/routing/rail-geometry.ts");
    const from: [number, number] = [49.0, 2.0];
    const to: [number, number] = [41.0, 28.0];
    expect(airArc(from, to, 16)).toEqual(smoothArc(from, to, 16, 0.15));
  });
});
