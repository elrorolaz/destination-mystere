// Planner M2 (routeur réel + vérification) — routeur factice, pas de réseau.

import { describe, expect, it } from "vitest";
import { haversineKm } from "../src/lib/geo/haversine.ts";
import { planJourney } from "../src/server/routing/planner.ts";
import type { AirportPick } from "../src/server/routing/flights.ts";
import { FakeRouter, makeItin, makeLeg } from "./helpers.ts";

const paris = { name: "Paris", lat: 48.8566, lng: 2.3522 };
const reims = { name: "Reims", lat: 49.2583, lng: 4.0317 };
const vienna = { name: "Vienne", lat: 48.2082, lng: 16.3738 };

const airports: AirportPick[] = [
  { iata: "CDG", name: "Paris CDG", city: "Paris", lat: 49.0097, lng: 2.5479, hubPopulation: 2200000 },
  { iata: "VIE", name: "Vienne", city: "Vienne", lat: 48.1103, lng: 16.5697, hubPopulation: 1900000 },
];

/** Routeur factice générique : un TER direct entre les deux points, durée donnée. */
function routerWith(directMin: number, accessMin = 30) {
  return new FakeRouter((from, to) => {
    const a = [from.lat, from.lng] as [number, number];
    const b = [to.lat, to.lng] as [number, number];
    // « accès aéroport » = trajet court (< 100 km), sinon trajet direct long.
    const isAccess = haversineKm(from.lat, from.lng, to.lat, to.lng) < 100;
    return [
      makeItin([
        makeLeg("rail", from.name, to.name, {
          lineOrCarrier: "TER",
          durationMin: isAccess ? accessMin : directMin,
          fromCoord: a,
          toCoord: b,
        }),
      ]),
    ];
  });
}

describe("planJourney — sélection et vérification", () => {
  it("trajet court (Paris → Reims) : le direct rail est retenu et vérifié", async () => {
    const planned = await planJourney(paris, reims, {
      router: routerWith(60),
      airports,
      dateKey: "2026-11-23",
      timeIso: "2026-11-23T07:00:00Z",
    });
    expect(planned.source).toBe("fake");
    expect(planned.journey.segments.some((s) => s.kind === "air")).toBe(false);
    expect(planned.verified.ok).toBe(true);
    expect(planned.journey.totalDurationMin).toBe(
      planned.journey.segments.reduce((a, s) => a + s.durationMin, 0),
    );
  });

  it("long trajet (Paris → Vienne) : le candidat avion gagne quand il est plus rapide", async () => {
    // direct 480 min ; accès aéroports 30 min chacun + vol ~113 min + 60 min de marge.
    const planned = await planJourney(paris, vienna, {
      router: routerWith(480, 30),
      airports,
      dateKey: "2026-11-23",
      timeIso: "2026-11-23T07:00:00Z",
    });
    const air = planned.journey.segments.find((s) => s.kind === "air");
    expect(air).toBeDefined();
    expect(air!.from).toBe("Paris (CDG)");
    expect(air!.to).toBe("Vienne (VIE)");
    expect(planned.journey.totalDurationMin).toBeLessThan(480);
    expect(planned.verified.ok).toBe(true);
  });

  it("si le direct est plus rapide que l'avion, l'avion n'est pas retenu", async () => {
    const planned = await planJourney(paris, vienna, {
      router: routerWith(150, 30), // direct 150 min < accès+vol
      airports,
      dateKey: "2026-11-23",
      timeIso: "2026-11-23T07:00:00Z",
    });
    expect(planned.journey.segments.some((s) => s.kind === "air")).toBe(false);
  });

  it("routeur sans aucun itinéraire → erreur (pas de génération synthétique)", async () => {
    const empty = new FakeRouter(() => []);
    await expect(
      planJourney(paris, reims, { router: empty, airports, dateKey: "2026-11-23", timeIso: "2026-11-23T07:00:00Z" }),
    ).rejects.toThrow("aucun itinéraire réaliste");
  });

  it("un itinéraire non vérifiable est marqué (verified.ok = false)", async () => {
    // Le routeur propose 60 min au planner, mais la vérification re-joue les legs
    // à des coordonnées décalées : on simule un écart en faisant échouer la vérif
    // via un journey plus lent que le best (tolérance 5 min).
    const slow = new FakeRouter((from, to) => [
      makeItin([
        makeLeg("rail", from.name, to.name, {
          lineOrCarrier: "TER",
          durationMin: from.name === paris.name && to.name === reims.name ? 60 : 200,
          fromCoord: [from.lat, from.lng],
          toCoord: [to.lat, to.lng],
        }),
      ]),
    ]);
    // Ici le planner voit 60 min (appel direct) — la vérif rejoue la même requête (60) → ok.
    // On force plutôt un journey sous-optimal via un routeur qui change de réponse :
    let calls = 0;
    const flip = new FakeRouter((from, to) => {
      calls++;
      const min = calls === 1 ? 300 : 60; // 1er appel (planner) lent, suivants rapides
      return [makeItin([makeLeg("rail", from.name, to.name, { lineOrCarrier: "TER", durationMin: min, fromCoord: [from.lat, from.lng], toCoord: [to.lat, to.lng] })])];
    });
    const planned = await planJourney(paris, reims, { router: flip, airports, dateKey: "2026-11-23", timeIso: "2026-11-23T07:00:00Z" });
    expect(planned.verified.ok).toBe(false);
    expect(planned.verified.reasons.some((r) => r.includes("sous-optimal"))).toBe(true);
    void slow;
  });
});

describe("planJourney — candidat avion (départ → aéroport A → vol A→B → aéroport B → arrivée)", () => {
  const brest = { name: "Brest", country: "FR", lat: 48.3904, lng: -4.4861 };
  const strasbourg = { name: "Strasbourg", country: "FR", lat: 48.5734, lng: 7.7521 };

  it("France → France, même long : JAMAIS d'avion (100 % rail)", async () => {
    // Brest → Strasbourg ≈ 850 km ≥ 600 : le candidat avion ne doit même pas
    // être construit quand les deux pays sont identiques.
    const planned = await planJourney(brest, strasbourg, {
      router: routerWith(400),
      airports,
      dateKey: "2026-11-23",
      timeIso: "2026-11-23T07:00:00Z",
    });
    expect(planned.journey.segments.some((s) => s.kind === "air")).toBe(false);
  });

  it("le trajet avion concatène : accès A (routeur) + vol + accès B (routeur)", async () => {
    const planned = await planJourney(paris, vienna, {
      router: routerWith(480, 30),
      airports,
      dateKey: "2026-11-23",
      timeIso: "2026-11-23T07:00:00Z",
    });
    const segs = planned.journey.segments;
    const airIdx = segs.findIndex((s) => s.kind === "air");
    expect(airIdx).toBeGreaterThan(0); // un tronçon au sol AVANT le vol
    expect(airIdx).toBeLessThan(segs.length - 1); // et un tronçon APRÈS
    expect(segs[airIdx]!.from).toBe("Paris (CDG)");
    expect(segs[airIdx]!.to).toBe("Vienne (VIE)");
    // Les accès aéroports sont des legs du routeur (nommés d'après les villes).
    expect(segs[0]!.from).toBe("Paris");
    expect(segs[segs.length - 1]!.to).toBe("Vienne");
    // Chaînage : le leg avant le vol arrive à l'aéroport A.
    expect(segs[airIdx - 1]!.toCoord).toEqual(segs[airIdx]!.fromCoord);
    expect(planned.verified.ok).toBe(true);
  });

  it("compagnie aérienne selon le pays de destination (VIE → Austrian Airlines)", async () => {
    const planned = await planJourney(
      { ...paris, country: "FR" },
      { ...vienna, country: "AT" },
      { router: routerWith(480, 30), airports, dateKey: "2026-11-23", timeIso: "2026-11-23T07:00:00Z" },
    );
    const air = planned.journey.segments.find((s) => s.kind === "air");
    expect(air).toBeDefined();
    expect(air!.lineOrCarrier).toBe("Austrian Airlines");
  });
});
