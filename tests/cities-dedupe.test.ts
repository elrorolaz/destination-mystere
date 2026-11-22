// Dédoublonnage des villes affichées (design) : un seul point par ville sur la
// carte, même quand des arrondissements portent le nom de la ville parente.

import { describe, expect, it } from "vitest";
import { dedupeCitiesByName } from "../src/lib/cities-dedupe.ts";

describe("dedupeCitiesByName (un seul point par ville avec arrondissements)", () => {
  it("garde la ville parente (plus peuplée) et élimine ses arrondissements", () => {
    const rows = [
      { id: "p13", name: "Paris", country: "FR", population: 30_000, lat: 48.85, lng: 2.29 },
      { id: "p15", name: "Paris", country: "FR", population: 25_000, lat: 48.84, lng: 2.27 },
      { id: "paris", name: "Paris", country: "FR", population: 2_100_000, lat: 48.8566, lng: 2.3522 },
      { id: "reims", name: "Reims", country: "FR", population: 180_000, lat: 49.26, lng: 4.03 },
    ];
    const out = dedupeCitiesByName(rows);
    const paris = out.filter((c) => c.name === "Paris");
    expect(paris).toHaveLength(1);
    expect(paris[0]?.id).toBe("paris"); // la parente, pas un arrondissement
    expect(out).toHaveLength(2); // Paris + Reims
  });

  it("ne fusionne pas des homonymes de pays différents", () => {
    const rows = [
      { id: "a", name: "Neustadt", country: "DE", population: 50_000 },
      { id: "b", name: "Neustadt", country: "AT", population: 12_000 },
    ];
    expect(dedupeCitiesByName(rows)).toHaveLength(2);
  });

  it("garde la première occurrence si populations égales, et préserve l'ordre des groupes", () => {
    const rows = [
      { id: "x", name: "Lyon", country: "FR", population: 10_000 },
      { id: "y", name: "Reims", country: "FR", population: 180_000 },
      { id: "z", name: "Lyon", country: "FR", population: 10_000 },
    ];
    const out = dedupeCitiesByName(rows);
    expect(out.map((c) => c.id)).toEqual(["x", "y"]);
  });

  it("liste vide → liste vide", () => {
    expect(dedupeCitiesByName([])).toEqual([]);
  });
});
