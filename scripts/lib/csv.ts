// Parseur CSV minimal : séparateur paramétrable, guillemets doubles,
// retours à la ligne CRLF/LF, BOM UTF-8 ignoré.

export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i] ?? "";

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Transforme « 48.855 » ou « 48,855 » en nombre (OpenData française). */
export function parseDecimalFrench(raw: string): number {
  const trimmed = raw.trim().replace(/\u00a0/g, "");
  const normalized =
    trimmed.includes(",") && !trimmed.includes(".")
      ? trimmed.replace(",", ".")
      : trimmed;
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new Error(`Nombre invalide : "${raw}"`);
  }
  return value;
}
