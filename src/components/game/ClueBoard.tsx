"use client";

// Panneau des indices A → E (M3) : présentation pure, tout vient du serveur.

import type { PublicHint } from "@/lib/game-types";

const KEYS = ["A", "B", "C", "D", "E"] as const;

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
              <p className="dm-hint-body">{hint.body}</p>
            </div>
          );
        }
        return (
          <div className="dm-hint locked" key={key}>
            <p className="dm-hint-title">{key} — Verrouillé</p>
            <p className="dm-hint-body">
              Se débloque après un essai manqué supplémentaire.
            </p>
          </div>
        );
      })}
    </section>
  );
}
