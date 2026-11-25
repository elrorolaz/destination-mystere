"use client";

// Écran de fin de partie (M3) : destination, score, historique en carrés,
// détail de l'itinéraire et texte de partage.

import { useState } from "react";
import type { PublicChallengeState, SegmentTrace } from "@/lib/game-types";
import { formatDuration } from "@/lib/format/duration";

const KIND_EMOJI: Record<string, string> = {
  rail: "🚆",
  urban: "🚇",
  air: "✈️",
  connection: "🚶",
  intercity_bus: "🚌",
};

export default function EndScreen({
  state,
  traces,
  onReplay,
  onClose,
  onReroll,
}: {
  state: PublicChallengeState;
  traces: SegmentTrace[];
  onReplay: () => void;
  /** Croix ✕ : masque l'écran pour voir l'itinéraire tracé sur la carte. */
  onClose: () => void;
  /** 🎲 Nouvel itinéraire de test (développement uniquement). */
  onReroll?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Signalement « itinéraire réaliste ? » : null = pas encore répondu,
  // "yes" = oui (rien n'est envoyé), "reported" = non (journalisé serveur),
  // "error" = échec réseau.
  const [feedback, setFeedback] = useState<null | "yes" | "reported" | "error">(null);
  const won = state.status === "WON";
  const squares = state.guesses
    .map((g) => (g.correct ? "🟩" : "🟥"))
    .join("");
  const followsTracks = traces.some((t) => t.followsTracks);
  const shareText =
    "🧭 Itinaris " +
    state.date +
    " " +
    (squares || "—") +
    " " +
    state.score +
    " pts";

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papier indisponible : rien de bloquant
    }
  };

  // « Non, cet itinéraire n'est pas réaliste » → journalisé serveur dans
  // data/logs/unrealistic-itineraries.jsonl. « Oui » : aucun envoi.
  const reportUnrealistic = async () => {
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realistic: false, date: state.date }),
      });
      setFeedback(res.ok ? "reported" : "error");
    } catch {
      setFeedback("error");
    }
  };

  return (
    <div className="dm-end-panel" role="dialog" aria-label="Résultat de la partie">
      <div className="dm-end-card">
        <button
          className="dm-end-close"
          type="button"
          onClick={onClose}
          aria-label="Masquer le résultat pour voir l'itinéraire sur la carte"
          title="Voir l'itinéraire sur la carte"
        >
          ✕
        </button>
        <h2>{won ? "🎉 Destination trouvée !" : "😵 C'était…"}</h2>
        <p className="dm-end-dest">
          {state.destination ? state.destination.name : "?"}{" "}
          {state.destination ? "(" + state.destination.country + ")" : ""}
        </p>
        <p className="dm-end-score">
          Score : <strong>{state.score}</strong> points ·{" "}
          {formatDuration(state.totalDurationMin)} de trajet au total
        </p>
        <p className="dm-squares" aria-label="Historique des essais">
          {squares}
        </p>

        <section className="dm-end-summary" aria-label="Récapitulatif des réponses">
          <h3>Récapitulatif des réponses</h3>
          {state.guesses.length === 0 ? (
            <p className="dm-hint-body">Aucune proposition.</p>
          ) : (
            <ol>
              {state.guesses.map((g) => (
                <li key={g.attemptNumber} className={g.correct ? "dm-guess-won" : ""}>
                  {g.city.name} ({g.city.country}) —{" "}
                  {g.correct ? "trouvé 🎉" : g.distanceKm + " km du but"}
                </li>
              ))}
            </ol>
          )}
        </section>

        {state.journey ? (
          <table className="dm-seg-table">
            <tbody>
              {state.journey.segments.map((s) => (
                <tr className="dm-seg-row" key={s.index}>
                  <td className="dm-seg-emoji">{KIND_EMOJI[s.kind] ?? "•"}</td>
                  <td>
                    {s.from} → {s.to}
                  </td>
                  <td className="dm-seg-kind">
                    {s.modeDetail}
                    {s.lineOrCarrier ? " · " + s.lineOrCarrier : ""}
                  </td>
                  <td className="dm-seg-kind">{formatDuration(s.durationMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <p className="dm-seg-note">
          {followsTracks
            ? "Sur la carte : le trajet suit les voies ferrées réelles (OpenStreetMap ou géométrie du réseau GTFS) ; l'arc aérien est illustratif."
            : "Tracé indicatif : infrastructure ferroviaire indisponible, lignes droites."}
        </p>
        <p className="dm-end-tip">
          💡 Cliquez sur la carte pour masquer ce panneau et voir l&apos;itinéraire ;
          le bouton « 🏁 Voir le résultat » en bas à droite le réaffiche.
        </p>

        <section className="dm-feedback" aria-label="Cet itinéraire est-il réaliste ?">
          {feedback === null ? (
            <>
              <p className="dm-feedback-q">Cet itinéraire vous paraît-il réaliste ?</p>
              <div className="dm-feedback-actions">
                <button
                  className="dm-btn dm-feedback-yes"
                  type="button"
                  onClick={() => setFeedback("yes")}
                >
                  ✅ Oui
                </button>
                <button
                  className="dm-btn dm-feedback-no"
                  type="button"
                  onClick={reportUnrealistic}
                >
                  ❌ Non
                </button>
              </div>
            </>
          ) : feedback === "reported" ? (
            <p className="dm-feedback-thanks">
              Merci ! Cet itinéraire a été signalé pour analyse. 🔍
            </p>
          ) : feedback === "error" ? (
            <p className="dm-feedback-thanks">
              Signalement non envoyé (réseau indisponible) — réessayez plus tard.
            </p>
          ) : (
            <p className="dm-feedback-thanks">Merci pour votre retour ! 👍</p>
          )}
        </section>

        <button className="dm-btn dm-share" type="button" onClick={copyShare}>
          {copied ? "Copié ✔" : "Copier mon résultat"}
        </button>
        {process.env.NODE_ENV === "development" ? (
          <button className="dm-btn" type="button" onClick={onReplay}>
            Rejouer
          </button>
        ) : null}
        {onReroll ? (
          <button className="dm-btn" type="button" onClick={onReroll}>
            🎲 Nouvel itinéraire
          </button>
        ) : null}
      </div>
    </div>
  );
}
