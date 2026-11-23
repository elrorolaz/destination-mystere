"use client";

// Panneau d'annonce d'un nouvel indice (UX) : à chaque indice débloqué (après
// un essai manqué), il s'affiche en grand au centre de l'écran ; une fois
// fermé, il reste disponible en plus petit dans le panneau latéral (ClueBoard).
// Le contenu vient du serveur ; l'affichage des durées de l'indice B est
// reformaté en heures/minutes (formatHintBody, purement cosmétique).

import type { PublicHint } from "@/lib/game-types";
import { formatHintBody } from "@/lib/format/hint-body";

export default function HintPopup({
  hint,
  onClose,
}: {
  hint: PublicHint;
  onClose: () => void;
}) {
  return (
    <div className="dm-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="dm-modal dm-hint-popup"
        role="alertdialog"
        aria-modal="true"
        aria-label={"Nouvel indice " + hint.key}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="dm-hint-popup-eyebrow">🔓 Nouvel indice débloqué</p>
        <h2 className="dm-hint-popup-title">
          {hint.key} — {hint.title}
        </h2>
        <p className="dm-hint-popup-body">{formatHintBody(hint.key, hint.body)}</p>
        <button type="button" className="dm-btn dm-btn-primary" onClick={onClose}>
          Compris !
        </button>
        <p className="dm-modal-hint">
          L&apos;indice reste affiché en petit dans le panneau latéral.
        </p>
      </div>
    </div>
  );
}
