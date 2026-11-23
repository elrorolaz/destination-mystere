"use client";

// Corps d'un indice avec logos des modes de transport (UX) : pour les indices
// A et B, chaque segment « Mode → Mode » est rendu avec le logo du mode
// (🚆 train, ✈️ avion, 🚇 transports urbains, 🚌 bus interurbain).
// L'indice B garde ses durées, formatées en heures/minutes.
// Purement d'affichage : le texte vient du serveur, non modifié.

import type { PublicHint } from "@/lib/game-types";
import { formatHintBody, splitHintSegments } from "@/lib/format/hint-body";

export default function HintBody({ hint }: { hint: PublicHint }) {
  if (hint.key !== "A" && hint.key !== "B") {
    return <p className="dm-hint-body">{hint.body}</p>;
  }
  const segments = splitHintSegments(formatHintBody(hint.key, hint.body));
  return (
    <p className="dm-hint-body dm-hint-modes" aria-label={hint.body}>
      {segments.map((s, i) => (
        <span className="dm-hint-mode" key={i}>
          {i > 0 ? <span className="dm-hint-arrow" aria-hidden="true">→</span> : null}
          {s.emoji ? (
            <span className="dm-hint-emoji" role="img" aria-label={s.label ?? ""}>
              {s.emoji}
            </span>
          ) : null}
          <span>{s.rest !== "" ? s.rest : (s.label ?? "")}</span>
        </span>
      ))}
    </p>
  );
}
