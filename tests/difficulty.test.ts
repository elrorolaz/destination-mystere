// Libellés du niveau de difficulté d'un itinéraire (formatDestTier) à partir
// du seuil de population de sa destination — affichés sur l'indicateur
// « itinéraire X/3 », l'intro et le panneau final.

import { describe, expect, it } from "vitest";
import { formatDestTier, formatDestTierShort } from "../src/lib/format/difficulty.ts";
import { minPopulationForSlot } from "../src/server/daily-challenge.ts";

describe("niveaux de difficulté par itinéraire", () => {
  it("seuils : 50 000 (itinéraire 1), 20 000 (2), 0 = toutes (3)", () => {
    expect(minPopulationForSlot(1)).toBe(50000);
    expect(minPopulationForSlot(2)).toBe(20000);
    expect(minPopulationForSlot(3)).toBe(0);
  });

  it("formatDestTier : le type de villes possibles est libellé", () => {
    expect(formatDestTier(minPopulationForSlot(1))).toBe("villes ≥ 50 000 hab.");
    expect(formatDestTier(minPopulationForSlot(2))).toBe("villes ≥ 20 000 hab.");
    expect(formatDestTier(minPopulationForSlot(3))).toBe("toutes les villes");
    // seuils intermédiaires : retombe sur la tranche inférieure
    expect(formatDestTier(30000)).toBe("villes ≥ 20 000 hab.");
    expect(formatDestTier(0)).toBe("toutes les villes");
  });

  it("formatDestTierShort : libellé court pour le tableau final", () => {
    expect(formatDestTierShort(50000)).toBe("≥ 50 000 hab.");
    expect(formatDestTierShort(20000)).toBe("≥ 20 000 hab.");
    expect(formatDestTierShort(0)).toBe("toutes villes");
  });
});
