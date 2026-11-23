"use client";

// Écran de chargement (UX) : affiché pendant le chargement / la génération de
// l'itinéraire du jour (ouverture du jeu, 🎲 reroll en dev) — l'opération peut
// prendre plusieurs secondes. Indicateur visuel de progression : spinner +
// barre indéterminée animée + message.

export default function LoadingOverlay({
  title,
  sub,
}: {
  /** Message principal, ex. « Chargement du défi du jour… ». */
  title: string;
  /** Sous-titre explicatif. */
  sub?: string;
}) {
  return (
    <div className="dm-loading" role="status" aria-live="polite">
      <div className="dm-loading-card">
        <div className="dm-spinner" aria-hidden="true" />
        <p className="dm-loading-title">{title}</p>
        <div
          className="dm-progress"
          role="progressbar"
          aria-label="Progression de la génération de l'itinéraire"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={undefined}
        >
          <div className="dm-progress-bar" />
        </div>
        <p className="dm-loading-sub">
          {sub ?? "Génération de l'itinéraire du jour en cours… cela peut prendre quelques secondes."}
        </p>
      </div>
    </div>
  );
}
