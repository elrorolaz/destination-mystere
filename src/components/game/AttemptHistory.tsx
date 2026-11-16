"use client";

// Historique des propositions (M3) : présentation pure.

import type { PublicGuess } from "@/lib/game-types";

export default function AttemptHistory({ guesses }: { guesses: PublicGuess[] }) {
  return (
    <section className="dm-card" aria-label="Propositions">
      <h2>Propositions ({guesses.length}/6)</h2>
      {guesses.length === 0 ? (
        <p className="dm-hint-body">
          Cliquez une ville sur la carte pour proposer votre première réponse.
        </p>
      ) : (
        <div>
          {guesses.map((g) => (
            <div
              className={"dm-hint" + (g.correct ? " open" : "")}
              key={g.attemptNumber}
            >
              <p className="dm-hint-title">
                {g.attemptNumber}. {g.city.name} —{" "}
                {g.correct ? "trouvé 🎉" : g.distanceKm + " km du but"}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
