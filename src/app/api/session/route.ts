// DELETE /api/session — rejouer la journée du jour (M3).
// Réservé au développement (DEV_FIXTURE=true ou random) : en production,
// une partie finie reste finie pour la journée (§6).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resetTodaysSession } from "../../../server/game-service.ts";
import { devFixtureMode } from "../../../server/challenge-store.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

export async function DELETE() {
  if (!devFixtureMode()) {
    return NextResponse.json(
      { error: "Rejouer n'est possible qu'en développement (DEV_FIXTURE=true ou random)" },
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
