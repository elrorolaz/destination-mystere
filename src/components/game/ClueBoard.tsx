"use client";

// Panneau des indices A → E (M3+) : présentation pure, tout vient du serveur.
// A/B/C/D se débloquent après les essais manqués 1 à 4 ; l'indice E (pays de
// la destination) après le 5ᵉ — il ne reste alors plus qu'un seul essai.

import type { PublicHint } from "@/lib/game-types";
import HintBody from "./HintBody";

const KEYS = ["A", "B", "C", "D", "E"] as const;

const LOCKED_TEXT: Record<string, string> = {
  D: "Se débloque après le 4ᵉ essai manqué.",
  E: "Se débloque après le 5ᵉ essai manqué ; il ne reste alors plus qu'un seul essai.",
};

export default function ClueBoard({
  hints,
  attemptCount,
}: {
  hints: PublicHint[];
  attemptCount: number;
}) {
  const byKey = new Map(hints.map((h) => [h.key, h]));
  return (
    <section className="dm-card" aria-label="Indices">
      <h2>
        Indices ({hints.length}/5) · essai {Math.min(attemptCount + 1, 6)}/6
      </h2>
      {KEYS.map((key) => {
        const hint = byKey.get(key);
        if (hint) {
          return (
            <div className="dm-hint open" key={key}>
              <p className="dm-hint-title">
                {key} — {hint.title}
              </p>
              {/* A/B : logos des modes ; B : durées en heures/minutes (« 1 h 47 »). */}
              <HintBody hint={hint} />
            </div>
          );
        }
        return (
          <div className="dm-hint locked" key={key}>
            <p className="dm-hint-title">{key} — Verrouillé</p>
            <p className="dm-hint-body">
              {LOCKED_TEXT[key] ?? "Se débloque après un essai manqué supplémentaire."}
            </p>
          </div>
        );
      })}
    </section>
  );
}
