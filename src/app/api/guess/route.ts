// POST /api/guess — enregistrer une proposition (M3).
// Le corps ne contient QUE { lat, lng } (§7) : le serveur effectue le snap,
// vérifie la réponse, déroule le score et renvoie le nouvel état public.

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { GameError, submitGuess } from "../../../server/game-service.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

export async function POST(req: NextRequest) {
  const store = await cookies();
  const guestKey = store.get(GUEST_COOKIE)?.value;
  if (!guestKey) {
    return NextResponse.json(
      { error: "Session introuvable, rechargez la page" },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Coordonnées manquantes" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Coordonnées hors du monde" }, { status: 400 });
  }

  try {
    const state = await submitGuess(guestKey, lat, lng);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof GameError) {
      const status = err.status === 404 ? 503 : err.status;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("POST /api/guess :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
