// GET /api/challenge — état public de la partie du jour (M3).
// Identité : cookie invité httpOnly « dm_guest » (les comptes arrivent en M4).
// Anti-triche §7 : la réponse ne contient jamais la destination ni le journey
// tant que la partie est ACTIVE — voir buildPublicState (testé).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GameError, getPublicState } from "../../../server/game-service.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";
const SIX_MONTHS_S = 60 * 60 * 24 * 182;

export async function GET() {
  try {
    const store = await cookies();
    let guestKey = store.get(GUEST_COOKIE)?.value;
    let cookieHeader: string | null = null;
    if (!guestKey) {
      guestKey = crypto.randomUUID();
      cookieHeader =
        GUEST_COOKIE + "=" + guestKey + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SIX_MONTHS_S;
    }
    const state = await getPublicState(guestKey);
    const res = NextResponse.json(state);
    if (cookieHeader) {
      res.headers.append("Set-Cookie", cookieHeader);
    }
    return res;
  } catch (err) {
    if (err instanceof GameError) {
      // Pas de défi aujourd'hui (génération M2 absente) : service indisponible.
      const status = err.status === 404 ? 503 : err.status;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("GET /api/challenge :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
