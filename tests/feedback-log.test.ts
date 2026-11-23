// Journal des signalements « itinéraire non réaliste » (feedback-log.ts) :
// une ligne JSON par signalement, fichier JSONL créé au besoin.

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logUnrealisticItinerary } from "../src/server/feedback-log.ts";

describe("logUnrealisticItinerary", () => {
  it("ajoute une ligne JSON par signalement dans un fichier JSONL", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dm-feedback-"));
    try {
      const file = path.join(dir, "logs", "unrealistic.jsonl");
      const report = {
        ts: "2026-11-23T10:00:00.000Z",
        date: "2026-11-23",
        origin: { id: "1", name: "Reims", country: "FR" },
        destination: { id: "2", name: "Vienne", country: "AT" },
        totalDurationMin: 325,
        journey: { totalDurationMin: 325, segments: [] },
      };
      logUnrealisticItinerary(report, file);
      logUnrealisticItinerary({ ...report, ts: "2026-11-23T11:00:00.000Z" }, file);
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      const parsed = JSON.parse(lines[0]!) as typeof report;
      expect(parsed.date).toBe("2026-11-23");
      expect(parsed.destination.name).toBe("Vienne");
      expect(parsed.journey).toEqual({ totalDurationMin: 325, segments: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
