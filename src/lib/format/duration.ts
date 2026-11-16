// Formatage des durées (spécification §3, src/lib/format/duration.ts).
// Le métier travaille en minutes entières ; l'affichage seul est humain.

/** 325 → « 5 h 25 », 46 → « 46 min », 60 → « 1 h ». */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "—";
  if (totalMinutes < 60) return totalMinutes + " min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return hours + " h";
  return hours + " h " + String(minutes).padStart(2, "0");
}
