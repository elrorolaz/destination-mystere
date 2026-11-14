// Téléchargements HTTP pour les scripts de préparation des données.
// Node 20+ expose fetch nativement ; on ajoute un timeout et des messages
// d'erreur explicites (cf. spécification : gestion d'erreur explicite sur
// tous les appels externes).

export async function downloadText(url: string, timeoutMs = 60_000): Promise<string> {
  const response = await fetchUrl(url, timeoutMs);
  return response.text();
}

export async function downloadBytes(url: string, timeoutMs = 120_000): Promise<Uint8Array> {
  const response = await fetchUrl(url, timeoutMs);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchUrl(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout (${timeoutMs} ms) — ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
