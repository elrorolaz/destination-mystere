// POST /api/route/next — passer à l'itinéraire suivant du match (bouton
// « Itinéraire suivant » de l'écran de résultat d'une manche). La manche
// courante doit être terminée ; l'itinéraire suivant est généré à la volée
// s'il ne l'est pas encore (la génération en fond est normalement déjà faite).
// Renvoie le nouvel état public du match.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GameError, nextRoute } from "../../../../server/game-service.ts";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "dm_guest";

export async function POST() {
  const store = await cookies();
  const guestKey = store.get(GUEST_COOKIE)?.value;
  if (!guestKey) {
    return NextResponse.json(
      { error: "Session introuvable, rechargez la page" },
      { status: 400 },
    );
  }
  try {
    const state = await nextRoute(guestKey);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/route/next :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
