// Extracteur ZIP minimal (lecture seule) basé sur zlib — évite toute
// dépendance npm pour décompresser cities5000.zip (GeoNames).
//
// Stratégie : on lit le répertoire central depuis la fin du fichier
// (End Of Central Directory), qui donne pour chaque entrée la taille
// compressée exacte et l'offset de son en-tête local ; puis on décompresse
// via inflateRaw (deflate). Les entrées stockées (méthode 0) sont copiées
// telles quelles.

import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

export function extractZip(buffer: Uint8Array): Map<string, Buffer> {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  // --- EOCD (signature PK\x05\x06) : on la cherche depuis la fin ---
  let eocdOffset = -1;
  const scanFloor = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= scanFloor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("EOCD introuvable — fichier ZIP invalide ?");
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true); // offset du répertoire central

  // --- Répertoire central (PK\x01\x02) ---
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error(`En-tête de répertoire central invalide (entrée ${n})`);
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const name = Buffer.from(
      buffer.subarray(cursor + 46, cursor + 46 + nameLength),
    ).toString("utf8");
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  // --- En-têtes locaux + données ---
  const files = new Map<string, Buffer>();
  for (const entry of entries.values()) {
    const local = entry.localHeaderOffset;
    if (view.getUint32(local, true) !== 0x04034b50) {
      throw new Error(`En-tête local invalide pour ${entry.name}`);
    }
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const dataStart = local + 30 + nameLength + extraLength;
    const raw = Buffer.from(
      buffer.subarray(dataStart, dataStart + entry.compressedSize),
    );

    if (entry.method === 0) {
      files.set(entry.name, raw);
    } else if (entry.method === 8) {
      files.set(entry.name, inflateRawSync(raw));
    } else {
      throw new Error(
        `Méthode de compression non supportée (${entry.method}) pour ${entry.name}`,
      );
    }
  }

  return files;
}
