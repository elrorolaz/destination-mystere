"use client";

// Écran de jeu (M3) : orchestre l'état public servi par /api/challenge, les
// propositions via /api/guess, et les tracés de fin de partie.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicChallengeState, SegmentTrace } from "@/lib/game-types";
import { formatDuration } from "@/lib/format/duration";
import GameMap from "@/components/map/GameMap";
import {
  getStoredMapTheme,
  getThemeDef,
  storeMapTheme,
  type MapThemeId,
} from "@/components/map/map-themes";
import AttemptHistory from "./AttemptHistory";
import ClueBoard from "./ClueBoard";
import EndScreen from "./EndScreen";
import IntroModal from "./IntroModal";
import LoadingOverlay from "./LoadingOverlay";

/** Score par essai réussi (§1.3) — miroir client de STANDARD_SCORES. */
const SCORES = [1000, 850, 700, 550, 400, 250];

export default function GameScreen() {
  const [state, setState] = useState<PublicChallengeState | null>(null);
  const [traces, setTraces] = useState<SegmentTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Écran de fin masqué (croix ✕ ou clic sur la carte) pour voir le tracé.
  const [endHidden, setEndHidden] = useState(false);
  // Écran d'accueil (départ + durée + règles) : affiché à l'ouverture tant que
  // la partie est active et pas encore vu pour cette date (sessionStorage).
  const [introOpen, setIntroOpen] = useState(false);
  // Incrémenté à chaque reroll : la carte remet ses épingles/tracés à zéro.
  const [resetKey, setResetKey] = useState(0);
  // Fond de carte choisi (design A/B/C) — persisté en localStorage.
  const [mapTheme, setMapTheme] = useState<MapThemeId>("nuit");
  const isDev = process.env.NODE_ENV === "development";

  // Lecture du thème mémorisé au montage (localStorage indisponible en SSR).
  useEffect(() => {
    setMapTheme(getStoredMapTheme());
  }, []);

  const chooseTheme = useCallback((id: MapThemeId) => {
    setMapTheme(id);
    storeMapTheme(id);
  }, []);

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
        // Écran d'accueil à l'ouverture du jeu (partie active, jamais vu ce jour).
        if (challenge.status === "ACTIVE") {
          try {
            if (window.sessionStorage.getItem("dm-intro-" + challenge.date) !== "1") {
              setIntroOpen(true);
            }
          } catch {
            setIntroOpen(true);
          }
        }
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

  const closeIntro = useCallback(() => {
    setIntroOpen(false);
    setState((s) => {
      if (s) {
        try {
          window.sessionStorage.setItem("dm-intro-" + s.date, "1");
        } catch {
          // sessionStorage indisponible : l'intro réapparaîtra au prochain chargement
        }
      }
      return s;
    });
  }, []);

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
        // Nouvel itinéraire chargé : on réaffiche l'écran d'accueil.
        setIntroOpen(true);
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
          {error ? (
            <div className="dm-map-msg">{error}</div>
          ) : (
            <LoadingOverlay title="Chargement du défi du jour…" />
          )}
        </div>
      </div>
    );
  }

  const potentialScore = SCORES[state.attemptCount] ?? 0;
  // Essais restants et indicateur « dernier essai » (6 essais max, §1.2).
  const remaining = Math.max(0, 6 - state.attemptCount);
  const isLastAttempt = state.status === "ACTIVE" && remaining === 1;

  return (
    <div className="dm-wrap">
      <header className="dm-topbar">
        <Link className="dm-logo" href="/">
          🧭 Destination <span>Mystère</span>
        </Link>
        <span>Défi du {state.date}</span>
      </header>

      <section className="dm-challenge-bar">
        <span>
          Départ : <strong>{state.origin.name}</strong> ({state.origin.country})
        </span>
        <span>
          Durée du trajet : <strong>{formatDuration(state.totalDurationMin)}</strong>
        </span>
        <span
          className="dm-attempts"
          aria-label={`Essais : ${state.attemptCount} utilisés sur 6, ${remaining} restant${remaining > 1 ? "s" : ""}`}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={
                "dm-attempt-dot" +
                (i < state.attemptCount ? " used" : "") +
                (i === state.attemptCount && state.status === "ACTIVE" ? " next" : "") +
                (i === 5 ? " last" : "")
              }
              title={
                i < state.attemptCount
                  ? `Essai ${i + 1} utilisé`
                  : i === 5
                    ? "Essai 6 — le dernier"
                    : `Essai ${i + 1}`
              }
            >
              {i + 1}
            </span>
          ))}
          {state.status === "ACTIVE" ? (
            <span className="dm-attempts-label">
              {remaining} restant{remaining > 1 ? "s" : ""}
            </span>
          ) : null}
        </span>
        {isLastAttempt ? (
          <span className="dm-last-attempt" role="alert">
            ⚠️ Dernier essai !
          </span>
        ) : null}
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
        <button
          type="button"
          className="dm-theme-toggle"
          onClick={() => chooseTheme(mapTheme === "nuit" ? "jour" : "nuit")}
          title={
            mapTheme === "nuit"
              ? "Passer en mode jour (fond D « Jour papier »)"
              : "Passer en mode nuit (fond A « Nuit étoilée »)"
          }
          aria-label={mapTheme === "nuit" ? "Passer en mode jour" : "Passer en mode nuit"}
        >
          <span
            className="dm-theme-swatch"
            style={{ backgroundColor: getThemeDef(mapTheme === "nuit" ? "jour" : "nuit").swatch }}
          />
          {mapTheme === "nuit" ? "☀️ Jour" : "🌙 Nuit"}
        </button>
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
          onMapClick={() => {
            // Fin de partie : un clic sur la carte masque le panneau de
            // résultat pour voir l'itinéraire tracé.
            if (state.status !== "ACTIVE") setEndHidden(true);
          }}
          resetKey={resetKey}
          mapTheme={mapTheme}
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

      {/* Panneau de résultat au CENTRE de l'écran ; un clic sur la carte
          (onMapClick) ou la croix ✕ le masque, le bouton ci-dessous le réaffiche. */}
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

      {/* Écran d'accueil : départ + durée + règles (clic en-dehors = jouer). */}
      {introOpen && state.status === "ACTIVE" ? (
        <IntroModal state={state} onClose={closeIntro} />
      ) : null}

      {/* Progression pendant la (re)génération d'un itinéraire (🎲 reroll). */}
      {busy && state ? (
        <LoadingOverlay
          title="🎲 Génération d'un nouvel itinéraire…"
          sub="Le serveur recalcule un trajet ; la partie reprendra ensuite."
        />
      ) : null}
    </div>
  );
}
