// DELETE /api/session — nouvelle partie : supprime le match du jour (les 3
// manches et leurs propositions) pour pouvoir rejouer les 3 itinéraires du
// jour. RÉSERVÉ AU DÉVELOPPEMENT (NODE_ENV=development) : en production, une
// seule partie par jour et par joueur — le rejouer est refusé (403).
// Les itinéraires du jour eux-mêmes ne changent pas (défi identique pour
// tous, §6.2) ; en développement, 🎲 /api/dev/reroll en génère de nouveaux.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resetTodaysSession } from "../../../server/game-service.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

export async function DELETE() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Une seule partie par jour — revenez demain pour un nouveau défi !" },
      { status: 403 },
    );
  }
  const store = await cookies();
  const guestKey = store.get(GUEST_COOKIE)?.value;
  if (!guestKey) {
    return NextResponse.json({ error: "Session introuvable" }, { status: 400 });
  }
  await resetTodaysSession(guestKey);
  return NextResponse.json({ ok: true });
}
