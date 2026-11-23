// Test du formatage d'affichage du corps des indices (UX) : l'indice B
// affiche les durées de segments en heures et minutes (« 1 h 47 » et non
// « 107 min »). Le serveur, lui, continue d'envoyer des minutes entières.

import { describe, expect, it } from "vitest";
import { formatHintBody, splitHintSegments } from "../src/lib/format/hint-body.ts";

describe("formatHintBody", () => {
  it("indice B : minutes → heures et minutes", () => {
    expect(formatHintBody("B", "Train · 38 min  →  Avion · 107 min  →  Transports urbains · 31 min")).toBe(
      "Train · 38 min  →  Avion · 1 h 47  →  Transports urbains · 31 min",
    );
  });

  it("indice B : cas limites 60 min et 325 min", () => {
    expect(formatHintBody("B", "Train · 60 min")).toBe("Train · 1 h");
    expect(formatHintBody("B", "Avion · 325 min")).toBe("Avion · 5 h 25");
  });

  it("les autres indices ne sont pas modifiés", () => {
    const a = "Train  →  Avion  →  Transports urbains";
    const c = "TER Grand Est · TGV inOui · Air France";
    const d = "Le trajet s'arrête à Nancy";
    expect(formatHintBody("A", a)).toBe(a);
    expect(formatHintBody("C", c)).toBe(c);
    expect(formatHintBody("D", d)).toBe(d);
  });

  it("texte sans durée : inchangé", () => {
    expect(formatHintBody("B", "Train seul")).toBe("Train seul");
  });
});

describe("splitHintSegments — logos des modes (indices A et B)", () => {
  it("indice A : chaque mode est reconnu avec son logo", () => {
    expect(splitHintSegments("Transports urbains  →  Avion  →  Train")).toEqual([
      { emoji: "🚇", label: "Transports urbains", rest: "" },
      { emoji: "✈️", label: "Avion", rest: "" },
      { emoji: "🚆", label: "Train", rest: "" },
    ]);
  });

  it("indice B : le mode est reconnu et la durée reste dans « rest »", () => {
    const segments = splitHintSegments(formatHintBody("B", "Train · 38 min  →  Avion · 107 min"));
    expect(segments).toEqual([
      { emoji: "🚆", label: "Train", rest: "· 38 min" },
      { emoji: "✈️", label: "Avion", rest: "· 1 h 47" },
    ]);
  });

  it("segment sans mode reconnu : pas de logo", () => {
    expect(splitHintSegments("Quelque chose")).toEqual([
      { emoji: null, label: null, rest: "Quelque chose" },
    ]);
  });
});
