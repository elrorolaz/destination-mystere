"use client";

// Écran de jeu (M3) : orchestre l'état public servi par /api/challenge, les
// propositions via /api/guess, et les tracés de fin de partie.

import { useCallback, useEffect, useState } from "react";
import type { PublicChallengeState, SegmentTrace } from "@/lib/game-types";
import { formatDuration } from "@/lib/format/duration";
import GameMap from "@/components/map/GameMap";
import AttemptHistory from "./AttemptHistory";
import ClueBoard from "./ClueBoard";
import EndScreen from "./EndScreen";

/** Score par essai réussi (§1.3) — miroir client de STANDARD_SCORES. */
const SCORES = [1000, 850, 700, 550, 400, 250];

export default function GameScreen() {
  const [state, setState] = useState<PublicChallengeState | null>(null);
  const [traces, setTraces] = useState<SegmentTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Écran de fin masqué par la croix ✕ pour voir l'itinéraire sur la carte.
  const [endHidden, setEndHidden] = useState(false);
  // Incrémenté à chaque reroll : la carte remet ses épingles/tracés à zéro.
  const [resetKey, setResetKey] = useState(0);
  const isDev = process.env.NODE_ENV === "development";

  const loadTraces = useCallback(async () => {
    try {
      const res = await fetch("/api/route-geometry");
      if (!res.ok) return;
      const json = (await res.json()) as { traces?: SegmentTrace[] };
      setTraces(json.traces ?? []);
    } catch {
      // Le tracé est indicatif : son absence n'est pas bloquante.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/challenge");
        const json: unknown = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          const message = (json as { error?: string }).error;
          setError(message ?? "Défi indisponible pour le moment.");
          return;
        }
        const challenge = json as PublicChallengeState;
        setState(challenge);
        setEndHidden(false);
        if (challenge.status !== "ACTIVE") {
          void loadTraces();
        }
      } catch {
        if (!cancelled) setError("Connexion impossible. Rechargez la page.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTraces]);

  const handleGuess = useCallback(
    async (lat: number, lng: number) => {
      if (busy || !state || state.status !== "ACTIVE") return;
      setBusy(true);
      try {
        const res = await fetch("/api/guess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        const json: unknown = await res.json();
        if (res.ok) {
          const next = json as PublicChallengeState;
          setState(next);
          if (next.status !== "ACTIVE") {
            void loadTraces();
          }
        } else {
          const message = (json as { error?: string }).error;
          setError(message ?? "Proposition refusée.");
          setTimeout(() => setError(null), 2500);
        }
      } catch {
        setError("Connexion impossible.");
        setTimeout(() => setError(null), 2500);
      } finally {
        setBusy(false);
      }
    },
    [busy, state, loadTraces],
  );

  const handleReplay = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // rien à faire : le bouton n'existe qu'en développement
    }
  }, []);

  // 🎲 Nouvel itinéraire de test (développement uniquement, DEV_FIXTURE=random) :
  // le serveur régénère le défi du jour, puis on recharge l'état public.
  const handleReroll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dev/reroll", { method: "POST" });
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => null);
        const message =
          json && typeof json === "object" && "error" in json
            ? String((json as { error: unknown }).error)
            : "Reroll refusé (DEV_FIXTURE=random requis).";
        setError(message);
        setTimeout(() => setError(null), 2500);
        return;
      }
      const challengeRes = await fetch("/api/challenge");
      if (challengeRes.ok) {
        const challenge = (await challengeRes.json()) as PublicChallengeState;
        setState(challenge);
        setTraces([]);
        setEndHidden(false);
        setResetKey((k) => k + 1);
      }
    } catch {
      setError("Connexion impossible.");
      setTimeout(() => setError(null), 2500);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!state) {
    return (
      <div className="dm-wrap">
        <div className="dm-map">
          <div className="dm-map-msg">{error ?? "Chargement du défi du jour…"}</div>
        </div>
      </div>
    );
  }

  const potentialScore = SCORES[state.attemptCount] ?? 0;

  return (
    <div className="dm-wrap">
      <header className="dm-topbar">
        <a className="dm-logo" href="/">
          🧭 Destination <span>Mystère</span>
        </a>
        <span>Défi du {state.date}</span>
      </header>

      <section className="dm-challenge-bar">
        <span>
          Départ : <strong>{state.origin.name}</strong> ({state.origin.country})
        </span>
        <span>
          Durée du trajet : <strong>{formatDuration(state.totalDurationMin)}</strong>
        </span>
        <span className="dm-attempts" aria-label="Essais">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={
                "dm-attempt-dot" +
                (i < state.attemptCount ? " used" : "") +
                (i === 5 ? " last" : "")
              }
            />
          ))}
        </span>
        <span>
          {state.status === "ACTIVE" ? (
            <>
              Score en jeu : <strong>{potentialScore}</strong>
            </>
          ) : (
            <>
              Score final : <strong>{state.score}</strong>
            </>
          )}
        </span>
        {isDev ? (
          <button
            className="dm-btn dm-reroll"
            type="button"
            onClick={handleReroll}
            disabled={busy}
            title="Générer un nouvel itinéraire de test (DEV_FIXTURE=random)"
          >
            🎲 Nouvel itinéraire
          </button>
        ) : null}
      </section>

      <div className="dm-grid">
        <GameMap
          origin={state.origin}
          destination={state.destination}
          guesses={state.guesses}
          active={state.status === "ACTIVE" && !busy}
          traces={traces}
          onGuess={handleGuess}
          resetKey={resetKey}
        />
        <aside className="dm-panel">
          {error ? (
            <div className="dm-card">
              <p className="dm-hint-body">{error}</p>
            </div>
          ) : null}
          <ClueBoard hints={state.hints} attemptCount={state.attemptCount} />
          <AttemptHistory guesses={state.guesses} />
        </aside>
      </div>

      {state.status !== "ACTIVE" && !endHidden ? (
        <EndScreen
          state={state}
          traces={traces}
          onReplay={handleReplay}
          onClose={() => setEndHidden(true)}
          onReroll={isDev ? handleReroll : undefined}
        />
      ) : null}

      {state.status !== "ACTIVE" && endHidden ? (
        <button
          className="dm-end-reopen"
          type="button"
          onClick={() => setEndHidden(false)}
        >
          🏁 Voir le résultat
        </button>
      ) : null}
    </div>
  );
}
