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
