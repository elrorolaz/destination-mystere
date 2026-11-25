"use client";

// Écran de RÉSULTAT FINAL du match (M3+) : affiché après le 3e itinéraire,
// quand le joueur sort du panneau de résultat classique de la dernière manche.
// Donne, pour chacun des 3 itinéraires : le score obtenu, la distance à la
// destination secrète (dernier essai), l'itinéraire (départ → arrivée) ;
// puis le SCORE FINAL (total des 3 manches). Un bouton relance une nouvelle
// partie (3 nouveaux itinéraires à jouer). Clic en-dehors / croix ✕ : masque
// le panneau pour voir les 3 itinéraires tracés sur la carte (couleurs et
// numéros distincts).

import type { PublicChallengeState } from "@/lib/game-types";
import { routeColor } from "@/components/map/RouteOverlay";

export default function FinalScreen({
  state,
  onClose,
  onRestart,
}: {
  state: PublicChallengeState;
  /** Croix ✕ : masque le panneau pour voir les 3 itinéraires sur la carte. */
  onClose: () => void;
  /** « 🔄 Nouvelle partie » : relance 3 itinéraires. */
  onRestart: () => void;
}) {
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

        <div className="dm-end-actions">
          <button className="dm-btn dm-btn-primary" type="button" onClick={onRestart}>
            🔄 Nouvelle partie (3 itinéraires)
          </button>
        </div>
      </div>
    </div>
  );
}
