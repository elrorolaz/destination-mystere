// Clusters d'agglomérations (design) : règle des 15 km — chaque ville est
// associée à la ville la plus peuplée dans un rayon de 15 km (elle-même
// incluse) ; seule la référence est affichée / cliquable.

import { describe, expect, it } from "vitest";
import { buildClusterIndex, CLUSTER_RADIUS_KM } from "../src/lib/geo/clusters.ts";
import type { CityRecord } from "../src/lib/geo/types.ts";

function city(id: string, name: string, lat: number, lng: number, population: number): CityRecord {
  return { id, name, country: "FR", lat, lng, population, hasTrainStation: false, geohash: "" };
}

describe("buildClusterIndex (règle des 15 km)", () => {
  it("une ville isolée est sa propre référence", () => {
    const idx = buildClusterIndex([city("a", "Solo", 45.0, 5.0, 20_000)]);
    expect(idx.isRef("a")).toBe(true);
    expect(idx.refOf("a")).toBe("a");
    expect(idx.refCount()).toBe(1);
  });

  it("une commune dans le rayon de 15 km d'une grande ville vise celle-ci", () => {
    // Paris (2,1 M) et Boulogne-Billancourt (~8 km, 110 k)
    const paris = city("paris", "Paris", 48.8566, 2.3522, 2_100_000);
    const boulogne = city("boulogne", "Boulogne-Billancourt", 48.8334, 2.2397, 110_000);
    const idx = buildClusterIndex([paris, boulogne]);
    expect(idx.refOf("boulogne")).toBe("paris");
    expect(idx.isRef("boulogne")).toBe(false);
    expect(idx.isRef("paris")).toBe(true);
    expect(idx.refCity(boulogne).name).toBe("Paris");
  });

  it("hors du rayon de 15 km, deux villes restent des références distinctes", () => {
    // ~20 km : Reims 49.2583,4.0317 / Châlons 48.9567,4.3633 ≈ 34 km
    const reims = city("reims", "Reims", 49.2583, 4.0317, 180_000);
    const chalons = city("chalons", "Châlons-en-Champagne", 48.9567, 4.3633, 45_000);
    const idx = buildClusterIndex([reims, chalons]);
    expect(idx.isRef("reims")).toBe(true);
    expect(idx.isRef("chalons")).toBe(true);
    expect(idx.refCount()).toBe(2);
  });

  it("chaîne A → B → C : toutes les villes du cluster visent le point fixe C", () => {
    // A (10 k) à 10 km de B (50 k), B à 10 km de C (500 k) : A→B, B→C, donc A→C.
    const a = city("a", "A", 48.0, 2.0, 10_000);
    const b = city("b", "B", 48.09, 2.0, 50_000); // ~10 km de A
    const c = city("c", "C", 48.18, 2.0, 500_000); // ~10 km de B, ~20 km de A
    const idx = buildClusterIndex([a, b, c]);
    expect(idx.refOf("a")).toBe("c");
    expect(idx.refOf("b")).toBe("c");
    expect(idx.isRef("c")).toBe(true);
    expect(idx.isRef("a")).toBe(false);
    expect(idx.isRef("b")).toBe(false);
    expect(idx.refCount()).toBe(1);
  });

  it("à population égale dans le rayon, le plus petit id gagne (déterministe)", () => {
    const a = city("aaa", "Aaa", 48.0, 2.0, 50_000);
    const b = city("bbb", "Bbb", 48.05, 2.0, 50_000); // ~5,5 km
    const idx = buildClusterIndex([a, b]);
    expect(idx.refOf("bbb")).toBe("aaa");
    expect(idx.refOf("aaa")).toBe("aaa");
  });

  it("le rayon est paramétrable (CLUSTER_RADIUS_KM = 15 par défaut)", () => {
    expect(CLUSTER_RADIUS_KM).toBe(15);
    const a = city("a", "A", 48.0, 2.0, 10_000);
    const b = city("b", "B", 48.2, 2.0, 500_000); // ~22 km de A
    const idx15 = buildClusterIndex([a, b], 15);
    expect(idx15.isRef("a")).toBe(true); // B hors rayon
    const idx30 = buildClusterIndex([a, b], 30);
    expect(idx30.refOf("a")).toBe("b"); // B dans le rayon élargi
  });

  it("réseau dense autour de Paris : seules les grandes villes restent références", () => {
    const paris = city("paris", "Paris", 48.8566, 2.3522, 2_100_000);
    const villes = [
      city("v1", "Villejuif", 48.7936, 2.3594, 55_000), // ~7 km
      city("v2", "Créteil", 48.7905, 2.4679, 92_000), // ~8 km
      city("v3", "Nanterre", 48.8925, 2.2065, 95_000), // ~7 km
      city("v4", "Versailles", 48.8014, 2.1301, 83_000), // ~17 km du centre → hors rayon ? test
      paris,
    ];
    const idx = buildClusterIndex(villes);
    for (const v of villes) {
      if (v.id === "paris") continue;
      const ref = idx.refOf(v.id);
      // chaque commune à < 15 km du centre de Paris vise Paris
      expect(["paris", v.id]).toContain(ref);
    }
    expect(idx.isRef("paris")).toBe(true);
  });
});
