// Nettoyage des correspondances de bordure (cleanup.ts) : les legs à pied
// « START → gare » / « gare → END » de 1–2 min du routeur sont fondus dans le
// premier/dernier tronçon de transport — durée totale et chaînage conservés.

import { describe, expect, it } from "vitest";
import type { JourneySegment } from "../src/server/routing/types.ts";
import { EDGE_CONNECTION_MAX_MIN, mergeEdgeConnections } from "../src/server/routing/cleanup.ts";

function seg(partial: Partial<JourneySegment> & Pick<JourneySegment, "kind" | "from" | "to" | "durationMin">): JourneySegment {
  return {
    index: 0,
    modeDetail: "",
    lineOrCarrier: "",
    fromCoord: [0, 0],
    toCoord: [1, 1],
    ...partial,
  } as JourneySegment;
}

describe("mergeEdgeConnections", () => {
  it("fusionne une correspondance de 1 min en tête dans le premier tronçon", () => {
    const out = mergeEdgeConnections([
      seg({ kind: "connection", from: "Reims", to: "Reims Gare", durationMin: 1, fromCoord: [49.25, 4.03], toCoord: [49.26, 4.03] }),
      seg({ kind: "rail", from: "Reims Gare", to: "Paris", durationMin: 46 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("rail");
    expect(out[0]!.from).toBe("Reims"); // départ = la ville (portes-à-portes)
    expect(out[0]!.fromCoord).toEqual([49.25, 4.03]);
    expect(out[0]!.to).toBe("Paris");
    expect(out[0]!.durationMin).toBe(47); // durée conservée
    expect(out[0]!.index).toBe(1);
  });

  it("fusionne une correspondance de 1 min en queue dans le dernier tronçon", () => {
    const out = mergeEdgeConnections([
      seg({ kind: "rail", from: "Paris", to: "Vienne Gare", durationMin: 300 }),
      seg({ kind: "connection", from: "Vienne Gare", to: "Vienne", durationMin: 1, toCoord: [48.2, 16.37] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.to).toBe("Vienne");
    expect(out[0]!.toCoord).toEqual([48.2, 16.37]);
    expect(out[0]!.durationMin).toBe(301);
  });

  it("tête + queue en même temps, réindexation des segments", () => {
    const out = mergeEdgeConnections([
      seg({ kind: "connection", from: "A", to: "A Gare", durationMin: 1 }),
      seg({ kind: "rail", from: "A Gare", to: "B Gare", durationMin: 60 }),
      seg({ kind: "connection", from: "B Gare", to: "B", durationMin: 2 }),
    ]);
    expect(out.map((s) => s.kind)).toEqual(["rail"]);
    expect(out[0]!.from).toBe("A");
    expect(out[0]!.to).toBe("B");
    expect(out[0]!.durationMin).toBe(63);
    expect(out[0]!.index).toBe(1);
  });

  it("ne touche PAS à une correspondance intermédiaire (même courte)", () => {
    const out = mergeEdgeConnections([
      seg({ kind: "rail", from: "A", to: "B", durationMin: 30 }),
      seg({ kind: "connection", from: "B", to: "B", durationMin: 1 }),
      seg({ kind: "rail", from: "B", to: "C", durationMin: 30 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out[1]!.kind).toBe("connection");
    expect(out.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it("ne fusionne pas une correspondance de bordure trop longue (> seuil)", () => {
    const out = mergeEdgeConnections([
      seg({ kind: "connection", from: "A", to: "A Gare", durationMin: EDGE_CONNECTION_MAX_MIN + 1 }),
      seg({ kind: "rail", from: "A Gare", to: "B", durationMin: 60 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("connection");
  });

  it("ne fusionne jamais dans un segment « air » (le vol part de l'aéroport)", () => {
    const out = mergeEdgeConnections([
      seg({ kind: "connection", from: "A", to: "Aéroport A", durationMin: 1 }),
      seg({ kind: "air", from: "Aéroport A", to: "Aéroport B", durationMin: 100 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]!.from).toBe("Aéroport A");
  });

  it("ne plante pas sur un journey d'un seul segment", () => {
    const out = mergeEdgeConnections([seg({ kind: "rail", from: "A", to: "B", durationMin: 30 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.durationMin).toBe(30);
  });

  it("conserve la somme des durées (totalDurationMin inchangé)", () => {
    const input = [
      seg({ kind: "connection", from: "A", to: "A Gare", durationMin: 1 }),
      seg({ kind: "rail", from: "A Gare", to: "B", durationMin: 60 }),
      seg({ kind: "connection", from: "B", to: "B", durationMin: 8 }),
      seg({ kind: "urban", from: "B", to: "C", durationMin: 10 }),
      seg({ kind: "connection", from: "C", to: "C Centre", durationMin: 2 }),
    ];
    const before = input.reduce((a, s) => a + s.durationMin, 0);
    const out = mergeEdgeConnections(input);
    expect(out.reduce((a, s) => a + s.durationMin, 0)).toBe(before);
  });
});
