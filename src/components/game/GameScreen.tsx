"use client";

// Écran de jeu (M3+) : orchestre l'état public servi par /api/challenge (match
// en 3 itinéraires), les propositions via /api/guess, la navigation entre
// manches via /api/route/next, et les tracés de fin de manche / de match.
//
// Flux : chaque itinéraire terminé → panneau de résultat de la manche, qui ne
// propose QUE « passer au suivant » (ou « voir le résultat final » après le
// 3e). Un clic en-dehors du panneau montre l'itinéraire tracé sur la carte,
// avec un bouton « itinéraire suivant » bien visible. Après le 3e itinéraire,
// un second panneau donne le résultat final (scores des 3 itinéraires, score
// total) et permet de relancer une nouvelle partie ; clic en-dehors → les 3
// itinéraires tracés sur la carte, chacun avec sa couleur et son numéro.

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
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
import FinalScreen from "./FinalScreen";
import IntroModal from "./IntroModal";
import LoadingOverlay from "./LoadingOverlay";

/** Score par essai réussi (§1.3) — miroir client de STANDARD_SCORES. */
const SCORES = [1000, 850, 700, 550, 400, 250];

export default function GameScreen() {
  const [state, setState] = useState<PublicChallengeState | null>(null);
  const [traces, setTraces] = useState<SegmentTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Requête en cours (proposition, passage à la manche suivante) : discret,
  // AUCUN écran de chargement (la carte reste réactive, juste non cliquable).
  const [busy, setBusy] = useState(false);
  // Génération de nouveaux itinéraires (🎲 reroll dev) : là seulement, overlay.
  const [generating, setGenerating] = useState(false);
  // Panneau de résultat de la manche masqué (croix ✕ ou clic sur la carte)
  // pour voir l'itinéraire tracé.
  const [endHidden, setEndHidden] = useState(false);
  // Panneau de résultat FINAL (match terminé) : affiché quand le joueur sort
  // du panneau de la 3e manche.
  const [finalOpen, setFinalOpen] = useState(false);
  // Écran d'accueil (départ + durée + règles) : affiché à l'ouverture tant que
  // la manche est active et pas encore vue pour cette date (sessionStorage).
  const [introOpen, setIntroOpen] = useState(false);
  // Incrémenté à chaque nouvelle manche / reroll : la carte est remise à zéro.
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

  /** Charge les tracés : une manche ({route}) ou les 3 itinéraires ({all}). */
  const loadTraces = useCallback(async (opts?: { all?: boolean; route?: number }) => {
    try {
      const params = new URLSearchParams();
      if (opts?.all) params.set("all", "1");
      else if (opts?.route) params.set("route", String(opts.route));
      const res = await fetch("/api/route-geometry" + (params.size ? "?" + params : ""));
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
        setFinalOpen(false);
        // Écran d'accueil à l'ouverture (manche active, jamais vu ce jour).
        if (challenge.status === "ACTIVE") {
          try {
            if (window.sessionStorage.getItem("dm-intro-" + challenge.date) !== "1") {
              setIntroOpen(true);
            }
          } catch {
            setIntroOpen(true);
          }
        }
        // Tracés : manche courante si terminée, les 3 si match terminé.
        if (challenge.matchFinished) {
          void loadTraces({ all: true });
        } else if (challenge.status !== "ACTIVE") {
          void loadTraces({ route: challenge.routeIndex });
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
            void loadTraces(
              next.matchFinished ? { all: true } : { route: next.routeIndex },
            );
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

  /**
   * « Itinéraire suivant » (panneau de résultat d'une manche) : après le 3e
   * itinéraire, ouvre directement le panneau de résultat final ; sinon appelle
   * POST /api/route/next et remet la carte à zéro pour la nouvelle manche.
   */
  const handleNext = useCallback(async () => {
    if (busy || !state) return;
    if (state.matchFinished) {
      // Sortie du panneau classique de la 3e manche → panneau de résultat final.
      setEndHidden(true);
      setFinalOpen(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/route/next", { method: "POST" });
      const json: unknown = await res.json();
      if (res.ok) {
        const next = json as PublicChallengeState;
        setState(next);
        setTraces([]);
        setEndHidden(false);
        setFinalOpen(false);
        setResetKey((k) => k + 1);
        if (next.status !== "ACTIVE") {
          void loadTraces(next.matchFinished ? { all: true } : { route: next.routeIndex });
        }
      } else {
        const message = (json as { error?: string }).error;
        setError(message ?? "Passage à l'itinéraire suivant refusé.");
        setTimeout(() => setError(null), 2500);
      }
    } catch {
      setError("Connexion impossible.");
      setTimeout(() => setError(null), 2500);
    } finally {
      setBusy(false);
    }
  }, [busy, state, loadTraces]);

  /** « 🔄 Nouvelle partie » (écran final) : efface le match du jour et recharge. */
  const handleRestart = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      setError("Connexion impossible.");
      setTimeout(() => setError(null), 2500);
    }
  }, []);

  // 🎲 Nouvel itinéraire de test (développement uniquement, DEV_FIXTURE=random) :
  // le serveur régénère les 3 itinéraires du jour, puis on recharge l'état public.
  const handleReroll = useCallback(async () => {
    if (busy || generating) return;
    setGenerating(true);
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
        setFinalOpen(false);
        setResetKey((k) => k + 1);
        // Nouveaux itinéraires chargés : on réaffiche l'écran d'accueil.
        setIntroOpen(true);
      }
    } catch {
      setError("Connexion impossible.");
      setTimeout(() => setError(null), 2500);
    } finally {
      setGenerating(false);
    }
  }, [busy, generating]);

  /**
   * Clic sur la carte en fin de manche : masque le panneau de résultat pour
   * voir le tracé. Match terminé : fermer le panneau classique ouvre le
   * panneau final ; fermer le panneau final ne montre que la carte (les 3
   * itinéraires tracés).
   */
  const handleMapClick = useCallback(() => {
    if (!state || state.status === "ACTIVE") return;
    if (state.matchFinished) {
      if (finalOpen) {
        // Le panneau final était ouvert : on ne montre plus que la carte.
        setFinalOpen(false);
        setEndHidden(true);
      } else {
        // Sortie du panneau classique de la 3e manche → panneau final.
        setEndHidden(true);
        setFinalOpen(true);
      }
    } else {
      setEndHidden(true);
    }
  }, [state, finalOpen]);

  /** Croix ✕ du panneau de manche : même comportement qu'un clic sur la carte. */
  const closeEndPanel = useCallback(() => {
    if (!state || state.status === "ACTIVE") return;
    if (state.matchFinished) {
      setEndHidden(true);
      setFinalOpen(true);
    } else {
      setEndHidden(true);
    }
  }, [state]);

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
  const mancheTerminee = state.status !== "ACTIVE";

  return (
    <div className="dm-wrap">
      <header className="dm-topbar">
        <Link className="dm-logo" href="/jouer">
          <Image
            src="/logo.jpeg"
            alt=""
            width={40}
            height={24}
            className="dm-logo-img"
            priority
          />
          <span className="dm-logo-text">
            Itin<span>aris</span>
          </span>
        </Link>
        <span>Défi du {state.date}</span>
      </header>

      <section className="dm-challenge-bar">
        <span className="dm-route-indicator" aria-label={`Itinéraire ${state.routeIndex} sur ${state.routeCount}`}>
          🧭 Itinéraire <strong>{state.routeIndex}/{state.routeCount}</strong>
        </span>
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
              Score : <strong>{state.score}</strong>
            </>
          )}
        </span>
        <span className="dm-total-score" aria-label={`Score total obtenu jusque là : ${state.totalScore} points`}>
          🏆 Total : <strong>{state.totalScore}</strong> pts
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
            disabled={busy || generating}
            title="Générer 3 nouveaux itinéraires de test (DEV_FIXTURE=random)"
          >
            🎲 Nouveaux itinéraires
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
          onMapClick={handleMapClick}
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

      {/* Panneau de résultat de la manche au CENTRE ; un clic sur la carte
          (onMapClick) ou la croix ✕ le masque. Après le 3e itinéraire, en
          sortir ouvre le panneau de résultat final. */}
      {mancheTerminee && !endHidden && !finalOpen ? (
        <EndScreen
          state={state}
          traces={traces}
          onNext={handleNext}
          nextLabel={
            state.matchFinished ? "🏁 Voir le résultat final" : "Itinéraire suivant →"
          }
          onClose={closeEndPanel}
        />
      ) : null}

      {/* Panneau de résultat FINAL (match terminé). */}
      {state.matchFinished && finalOpen ? (
        <FinalScreen
          state={state}
          onClose={() => setFinalOpen(false)}
          onRestart={handleRestart}
        />
      ) : null}

      {/* Boutons flottants quand les panneaux sont masqués (carte visible). */}
      {mancheTerminee && !state.matchFinished && endHidden ? (
        <button
          className="dm-end-reopen dm-next-float"
          type="button"
          onClick={handleNext}
        >
          ▶ Itinéraire suivant ({state.routeIndex + 1}/{state.routeCount})
        </button>
      ) : null}
      {state.matchFinished && endHidden && !finalOpen ? (
        <div className="dm-float-actions">
          <button
            className="dm-end-reopen"
            type="button"
            onClick={() => setEndHidden(false)}
          >
            🏁 Résultat de l&apos;itinéraire {state.routeCount}
          </button>
          <button
            className="dm-end-reopen dm-next-float"
            type="button"
            onClick={() => setFinalOpen(true)}
          >
            📊 Résultat final
          </button>
        </div>
      ) : null}

      {/* Écran d'accueil : départ + durée + règles (clic en-dehors = jouer). */}
      {introOpen && state.status === "ACTIVE" ? (
        <IntroModal state={state} onClose={closeIntro} />
      ) : null}

      {/* Écran de chargement UNIQUEMENT pendant la génération de nouveaux
          itinéraires (🎲 reroll) — jamais à chaque tentative de destination. */}
      {generating ? (
        <LoadingOverlay
          title="🎲 Génération de nouveaux itinéraires…"
          sub="Le serveur calcule les 3 itinéraires du jour ; la partie reprendra ensuite."
        />
      ) : null}
    </div>
  );
}
