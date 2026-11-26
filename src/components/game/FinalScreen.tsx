"use client";

// Écran de RÉSULTAT FINAL du match (M3+) : affiché après le 3e itinéraire,
// quand le joueur sort du panneau de résultat classique de la dernière manche.
// Donne, pour chacun des 3 itinéraires : le score obtenu, la distance à la
// destination secrète (dernier essai), l'itinéraire (départ → arrivée) ;
// puis le SCORE FINAL (total des 3 manches, multiplicateurs ×1 / ×1,5 / ×2
// appliqués).
//
// Une seule partie par jour en production : PAS de bouton « rejouer » ici
// (uniquement en développement, quand onRestart est fourni). À la place, des
// boutons de PARTAGE du résultat sur les réseaux sociaux (WhatsApp, X, feuille
// de partage système qui inclut Instagram…) + copie dans le presse-papier.
// Le texte partagé ne contient JAMAIS les itinéraires (anti-spoiler) :
// uniquement date, carrés 🟥/🟩, points et total — voir buildShareText.

import { useState } from "react";
import type { PublicChallengeState } from "@/lib/game-types";
import { buildShareText } from "@/lib/format/share";
import { formatDestTierShort } from "@/lib/format/difficulty";
import { routeColor } from "@/components/map/RouteOverlay";

export default function FinalScreen({
  state,
  onClose,
  onRestart,
}: {
  state: PublicChallengeState;
  /** Croix ✕ : masque le panneau pour voir les 3 itinéraires sur la carte. */
  onClose: () => void;
  /**
   * « 🔄 Rejouer » — fourni UNIQUEMENT en mode développement (NODE_ENV ===
   * "development") : en production, une seule partie par jour, aucun rejouer.
   */
  onRestart?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Texte partagé : JAMAIS de nom de ville ni de détail d'itinéraire.
  const shareText = buildShareText(state);
  const shareUrl = typeof window === "undefined" ? "" : window.location.origin;

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papier indisponible : rien de bloquant
    }
  };

  /** Feuille de partage du système (Instagram, WhatsApp, Messenger… sur mobile). */
  const systemShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Itinaris — " + state.date, text: shareText, url: shareUrl });
        return;
      } catch {
        return; // annulé par l'utilisateur : on retombe sur la copie
      }
    }
    await copyShare();
  };

  const openNetwork = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const enc = encodeURIComponent(shareText + "\n" + shareUrl);

  return (
    <div className="dm-end-panel" role="dialog" aria-label="Résultat final de la partie">
      <div className="dm-end-card dm-final-card">
        <button
          className="dm-end-close"
          type="button"
          onClick={onClose}
          aria-label="Masquer le résultat final pour voir les 3 itinéraires sur la carte"
          title="Voir les 3 itinéraires sur la carte"
        >
          ✕
        </button>
        <h2>🏁 Résultat final</h2>
        <p className="dm-end-route-badge">Défi du {state.date} — {state.routeCount} itinéraires</p>

        <table className="dm-final-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Itinéraire</th>
              <th>Niveau</th>
              <th>Distance au but</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {state.routeResults.map((r) => (
              <tr key={r.index}>
                <td>
                  <span
                    className="dm-route-badge"
                    style={{ backgroundColor: routeColor(r.index) }}
                  >
                    {r.index}
                  </span>
                </td>
                <td className="dm-final-route">
                  {r.origin && r.destination ? (
                    <>
                      <strong>{r.origin.name}</strong> → <strong>{r.destination.name}</strong>
                      <span className="dm-final-status">
                        {r.status === "WON"
                          ? ` · trouvé en ${r.attemptCount} essai${r.attemptCount > 1 ? "s" : ""}`
                          : " · non trouvé"}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="dm-final-tier" title={formatDestTierShort(r.destMinPopulation)}>
                  🎯 {formatDestTierShort(r.destMinPopulation)}
                </td>
                <td>
                  {r.lastDistanceKm === null
                    ? "—"
                    : r.status === "WON"
                      ? "0 km 🎯"
                      : r.lastDistanceKm + " km"}
                </td>
                <td>
                  <strong>{r.score}</strong> pts
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="dm-final-total">
          Score final : <strong>{state.totalScore}</strong> points
        </p>

        <p className="dm-end-tip">
          🗺️ Cliquez sur la carte (ou ✕) pour voir les 3 itinéraires tracés —
          chacun a sa couleur et son numéro (1, 2, 3).
        </p>

        {/* Partage du résultat — le texte partagé ne révèle aucun itinéraire
            (pas de nom de ville), pour ne pas spoiler les autres joueurs. */}
        <section className="dm-share-section" aria-label="Partager mon résultat">
          <p className="dm-share-title">📣 Partager mon résultat</p>
          <div className="dm-share-networks">
            <button
              className="dm-btn dm-share-net"
              type="button"
              onClick={() => openNetwork("https://wa.me/?text=" + enc)}
              title="Partager sur WhatsApp"
            >
              WhatsApp
            </button>
            <button
              className="dm-btn dm-share-net"
              type="button"
              onClick={() =>
                openNetwork("https://twitter.com/intent/tweet?text=" + enc)
              }
              title="Partager sur X"
            >
              X
            </button>
            <button
              className="dm-btn dm-share-net"
              type="button"
              onClick={() => void systemShare()}
              title="Ouvrir la feuille de partage (Instagram, Messenger, SMS…) — sinon copie dans le presse-papier"
            >
              📲 Partager…
            </button>
            <button className="dm-btn dm-share-net" type="button" onClick={() => void copyShare()}>
              {copied ? "Copié ✔" : "📋 Copier"}
            </button>
          </div>
          <p className="dm-share-note">
            Le texte partagé ne contient que vos carrés et vos points — jamais
            les itinéraires du jour.
          </p>
        </section>

        <div className="dm-end-actions">
          {onRestart ? (
            <button className="dm-btn dm-btn-primary" type="button" onClick={onRestart}>
              🔄 Rejouer (dev)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
