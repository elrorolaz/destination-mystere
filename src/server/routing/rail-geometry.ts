// Tracé de fin de partie qui suit les voies ferrées réelles (M3).
//
// Principe : les segments rail/urban du journey portent des coordonnées
// d'extrémités (fromCoord/toCoord, voir routing/types.ts). On interroge
// OpenStreetMap (Overpass) pour récupérer les voies ferrées du corridor, on
// construit un graphe (nœuds = points de géométrie partagés entre voies,
// arêtes = tronçons), puis on cherche le plus court chemin entre les deux
// extrémités (Dijkstra). Repli : ligne droite si Overpass est indisponible,
// si le graphe est déconnecté ou si le chemin est aberrant (> 4 × la
// distance à vol d'oiseau).

import { haversineKm } from "../../lib/geo/haversine.ts";

export type LatLon = [number, number]; // [lat, lng]

export interface RawWay {
  id: number;
  geometry: LatLon[];
}

export interface RailGraph {
  nodes: Map<string, LatLon>;
  adj: Map<string, Array<{ to: string; km: number }>>;
}

const nodeKey = (p: LatLon): string => p[0].toFixed(6) + "|" + p[1].toFixed(6);

/** Graphe non orienté des voies : les points de géométrie identiques sont fusionnés. */
export function buildRailGraph(ways: RawWay[]): RailGraph {
  const nodes = new Map<string, LatLon>();
  const adj = new Map<string, Array<{ to: string; km: number }>>();
  const link = (a: string, b: string, km: number): void => {
    const out = adj.get(a);
    if (out) {
      out.push({ to: b, km });
    } else {
      adj.set(a, [{ to: b, km }]);
    }
    const back = adj.get(b);
    if (back) {
      back.push({ to: a, km });
    } else {
      adj.set(b, [{ to: a, km }]);
    }
  };
  for (const way of ways) {
    let prevKey: string | null = null;
    let prevPoint: LatLon | null = null;
    for (const point of way.geometry) {
      const key = nodeKey(point);
      if (!nodes.has(key)) {
        nodes.set(key, point);
        adj.set(key, []);
      }
      if (prevKey && prevPoint) {
        link(prevKey, key, haversineKm(prevPoint[0], prevPoint[1], point[0], point[1]));
      }
      prevKey = key;
      prevPoint = point;
    }
  }
  return { nodes, adj };
}

/** Nœud du graphe le plus proche d'un point (à vol d'oiseau). */
export function nearestNode(graph: RailGraph, point: LatLon): string | null {
  let bestKey: string | null = null;
  let bestKm = Infinity;
  for (const [key, node] of graph.nodes) {
    const km = haversineKm(point[0], point[1], node[0], node[1]);
    if (km < bestKm) {
      bestKm = km;
      bestKey = key;
    }
  }
  return bestKey;
}

interface HeapItem {
  key: string;
  d: number;
}

class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: HeapItem): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parentIndex = (i - 1) >> 1;
      const parent = this.items[parentIndex]!;
      const current = this.items[i]!;
      if (parent.d <= current.d) break;
      this.items[parentIndex] = current;
      this.items[i] = parent;
      i = parentIndex;
    }
  }

  pop(): HeapItem | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < this.items.length && this.items[left]!.d < this.items[smallest]!.d) {
          smallest = left;
        }
        if (right < this.items.length && this.items[right]!.d < this.items[smallest]!.d) {
          smallest = right;
        }
        if (smallest === i) break;
        const tmp = this.items[i]!;
        this.items[i] = this.items[smallest]!;
        this.items[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

/** Plus court chemin Dijkstra entre deux nœuds, en kilomètres. */
export function shortestRailPath(
  graph: RailGraph,
  startKey: string,
  endKey: string,
): LatLon[] | null {
  const start = graph.nodes.get(startKey);
  if (!start) return null;
  if (startKey === endKey) return [start];

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const heap = new MinHeap();
  dist.set(startKey, 0);
  heap.push({ key: startKey, d: 0 });
  let found = false;

  while (heap.size > 0) {
    const item = heap.pop();
    if (!item) break;
    if (item.d > (dist.get(item.key) ?? Infinity)) continue;
    if (item.key === endKey) {
      found = true;
      break;
    }
    const edges = graph.adj.get(item.key) ?? [];
    for (const edge of edges) {
      const candidate = item.d + edge.km;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
        prev.set(edge.to, item.key);
        heap.push({ key: edge.to, d: candidate });
      }
    }
  }
  if (!found) return null;

  const reversed: string[] = [];
  let cursor = endKey;
  while (cursor !== startKey) {
    reversed.push(cursor);
    const parent = prev.get(cursor);
    if (!parent) return null; // défensif
    cursor = parent;
  }
  reversed.push(startKey);

  const path: LatLon[] = [];
  for (const key of reversed.reverse()) {
    const node = graph.nodes.get(key);
    if (node) path.push(node);
  }
  return path;
}

/** Chemin sur un jeu de voies — commodité pour les tests et le repli. */
export function pathAlongWays(
  ways: RawWay[],
  from: LatLon,
  to: LatLon,
): LatLon[] | null {
  const graph = buildRailGraph(ways);
  const startKey = nearestNode(graph, from);
  const endKey = nearestNode(graph, to);
  if (!startKey || !endKey) return null;
  return shortestRailPath(graph, startKey, endKey);
}

/** Longueur totale d'une polyligne, en kilomètres. */
export function polylineKm(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += haversineKm(a[0], a[1], b[0], b[1]);
  }
  return total;
}

function perpendicularDistance(a: LatLon, b: LatLon, p: LatLon): number {
  const ax = a[1];
  const ay = a[0];
  const dx = b[1] - ax;
  const dy = b[0] - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p[1] - ax, p[0] - ay);
  }
  const t = ((p[1] - ax) * dx + (p[0] - ay) * dy) / lenSq;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(p[1] - cx, p[0] - cy);
}

/**
 * Simplification Douglas-Peucker (itérative) : epsilon en degrés
 * (~0,0003 ° ≈ 30 m) pour alléger la géométrie renvoyée au client.
 */
export function simplifyPath(points: LatLon[], epsilonDeg: number): LatLon[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const start = range[0];
    const end = range[1];
    if (end - start < 2) continue;
    const a = points[start]!;
    const b = points[end]!;
    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const dist = perpendicularDistance(a, b, p);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxDist > epsilonDeg && maxIndex >= 0) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex]);
      stack.push([maxIndex, end]);
    }
  }
  const result: LatLon[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      const p = points[i];
      if (p) result.push(p);
    }
  }
  return result;
}

/**
 * Courbe de Bézier quadratique entre deux points, bombée vers le nord,
 * échantillonnée en « steps » points. Pas de réseau à interroger.
 * `bulge` = fraction de la corde dont le point de contrôle est décalé
 * (0,15 = arc aérien marqué ; 0,06 = courbe douce de repli).
 */
export function smoothArc(from: LatLon, to: LatLon, steps = 48, bulge = 0.15): LatLon[] {
  const midLat = (from[0] + to[0]) / 2;
  const midLng = (from[1] + to[1]) / 2;
  const dLat = to[0] - from[0];
  const dLng = to[1] - from[1];
  const norm = Math.hypot(dLat, dLng) || 1;
  const offset = norm * bulge;
  // Perpendiculaire à la corde, orientée vers le nord.
  let px = -dLng / norm;
  let py = dLat / norm;
  if (px < 0) {
    px = -px;
    py = -py;
  }
  const cLat = midLat + px * offset;
  const cLng = midLng + py * offset;
  const points: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * from[0] + 2 * u * t * cLat + t * t * to[0],
      u * u * from[1] + 2 * u * t * cLng + t * t * to[1],
    ]);
  }
  return points;
}

/**
 * Arc aérien (M3) : Bézier quadratique entre deux aéroports, bombée vers le
 * nord (bulge 0,15), échantillonnée en « steps » points.
 */
export function airArc(from: LatLon, to: LatLon, steps = 48): LatLon[] {
  return smoothArc(from, to, steps, 0.15);
}

/* ---------- Overpass (OpenStreetMap) ---------- */

const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].filter((url): url is string => typeof url === "string" && url.length > 0);

interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Corridor autour des deux extrémités : fixe + 12 % du plus grand écart. */
function corridor(from: LatLon, to: LatLon): Bbox {
  const span = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  const pad = 0.15 + 0.12 * span;
  return {
    south: Math.min(from[0], to[0]) - pad,
    north: Math.max(from[0], to[0]) + pad,
    west: Math.min(from[1], to[1]) - pad,
    east: Math.max(from[1], to[1]) + pad,
  };
}

/** Voies ferrées du corridor : rail, RER, métro, tram (hors triage/sillage). */
async function fetchRailWays(bbox: Bbox): Promise<RawWay[] | null> {
  const query =
    '[out:json][timeout:25];' +
    'way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"]' +
    '["service"!~"^(siding|yard|spur|crossover)$"]' +
    "(" +
    bbox.south.toFixed(4) +
    "," +
    bbox.west.toFixed(4) +
    "," +
    bbox.north.toFixed(4) +
    "," +
    bbox.east.toFixed(4) +
    ");" +
    "out geom;";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        elements?: Array<{
          type: string;
          id: number;
          geometry?: Array<{ lat: number; lon: number }>;
        }>;
      };
      const ways: RawWay[] = [];
      for (const el of json.elements ?? []) {
        if (el.type === "way" && el.geometry) {
          ways.push({
            id: el.id,
            geometry: el.geometry.map((p) => [p.lat, p.lon] as LatLon),
          });
        }
      }
      return ways;
    } catch {
      // Endpoint indisponible ou délai dépassé : essayer le suivant.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/* ---------- Mise en cache process (le tracé ne change pas dans la journée) ---------- */

const geometryCache = new Map<string, { at: number; path: LatLon[] }>();
const GEOMETRY_TTL_MS = 6 * 60 * 60 * 1000;

export interface RailPathResult {
  geometry: LatLon[];
  followsTracks: boolean;
}

/**
 * Tracé d'un segment rail/urban entre deux points : suit les voies ferrées
 * réelles ; repli sur la ligne droite si l'infrastructure est indisponible.
 */
export async function railPath(from: LatLon, to: LatLon): Promise<RailPathResult> {
  const cacheKey =
    from[0].toFixed(4) + "," + from[1].toFixed(4) + ">" + to[0].toFixed(4) + "," + to[1].toFixed(4);
  const hit = geometryCache.get(cacheKey);
  if (hit && Date.now() - hit.at < GEOMETRY_TTL_MS) {
    return { geometry: hit.path, followsTracks: true };
  }

  const ways = await fetchRailWays(corridor(from, to));
  if (ways) {
    const graph = buildRailGraph(ways);
    const startKey = nearestNode(graph, from);
    const endKey = nearestNode(graph, to);
    if (startKey && endKey) {
      const path = shortestRailPath(graph, startKey, endKey);
      if (path) {
        const simplified = simplifyPath(path, 0.0003); // ~30 m
        const direct = haversineKm(from[0], from[1], to[0], to[1]);
        const along = polylineKm(simplified);
        if (direct <= 5 || along <= 4 * direct) {
          geometryCache.set(cacheKey, { at: Date.now(), path: simplified });
          return { geometry: simplified, followsTracks: true };
        }
      }
    }
  }
  return { geometry: [from, to], followsTracks: false };
}
