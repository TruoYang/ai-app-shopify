// CSV helpers shared by the Data page (browser preview) and the server import.
// Pure functions only: no Node or database imports.

export const ROLES = ["orderId", "productCode", "productName", "quantity", "date", "price", "customerId"];
export const REQUIRED_ROLES = ["orderId", "productCode"];

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/đ/gi, "d")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

// Normalized header names per role, most specific first.
const HEADER_HINTS = {
  orderId: ["orderid", "ordernumber", "orderno", "order", "invoiceno", "invoiceid", "invoice", "name", "transactionid", "receiptid", "madon", "madonhang", "sohoadon", "donhang"],
  productCode: ["lineitemsku", "variantsku", "sku", "stockcode", "productcode", "productid", "itemcode", "itemid", "articleid", "masp", "masanpham", "mahang"],
  productName: ["lineitemname", "productname", "producttitle", "itemname", "description", "title", "tensanpham", "tensp", "tenhang", "ten"],
  quantity: ["lineitemquantity", "quantity", "qty", "soluong", "sl"],
  date: ["invoicedate", "orderdate", "createdat", "paidat", "date", "datetime", "timestamp", "ngay", "ngaymua", "ngaydat"],
  price: ["lineitemprice", "unitprice", "price", "gia", "dongia"],
  customerId: ["customerid", "customer", "email", "makhachhang", "khachhang"],
};

export function detectDelimiter(sample) {
  const lines = sample.split(/\r?\n/).filter(Boolean).slice(0, 10);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of [",", ";", "\t", "|"]) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const consistent = counts.every((count) => count === counts[0]);
    const score = (counts[0] ?? 0) * (consistent ? 2 : 1);
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

const DATE_LIKE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

// Returns { [header]: role | "ignore" } for the given headers and a few sample rows.
export function guessRoles(headers, sampleRows = []) {
  const roles = {};
  const taken = new Set();
  const normalized = headers.map(normalize);

  for (const role of ROLES) {
    for (const hint of HEADER_HINTS[role]) {
      const index = normalized.findIndex((header, i) => !roles[headers[i]] && header === hint);
      if (index >= 0) {
        roles[headers[index]] = role;
        taken.add(role);
        break;
      }
    }
  }
  // Second pass: headers that contain a hint ("Order Number (internal)").
  for (const role of ROLES) {
    if (taken.has(role)) continue;
    const index = normalized.findIndex((header, i) =>
      !roles[headers[i]] && HEADER_HINTS[role].some((hint) => hint.length >= 3 && header.includes(hint)));
    if (index >= 0) {
      roles[headers[index]] = role;
      taken.add(role);
    }
  }
  // Content fallback for the date column.
  if (!taken.has("date")) {
    const index = headers.findIndex((header, i) =>
      !roles[header] && sampleRows.length > 0 && sampleRows.every((row) => DATE_LIKE.test(String(row[i] ?? ""))));
    if (index >= 0) roles[headers[index]] = "date";
  }

  headers.forEach((header) => { roles[header] ??= "ignore"; });
  return roles;
}

// "iso" (2024-03-01), "dmy" (01/03/2024) or "mdy" (3/1/2024), judged from sample values.
export function guessDateFormat(values) {
  const parts = values.map((value) => String(value).trim().split(/[\sT]/)[0]).filter(Boolean);
  if (parts.length === 0 || parts.every((part) => /^\d{4}[-/.]/.test(part))) return "iso";
  const firsts = parts.map((part) => Number(part.split(/[-/.]/)[0]));
  const seconds = parts.map((part) => Number(part.split(/[-/.]/)[1]));
  if (firsts.some((n) => n > 12)) return "dmy";
  if (seconds.some((n) => n > 12)) return "mdy";
  return "dmy";
}

export function parseDate(value, format) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (format === "iso") {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const [datePart, timePart = ""] = text.split(/\s+/);
  const pieces = datePart.split(/[-/.]/).map(Number);
  if (pieces.length < 3 || pieces.some(Number.isNaN)) return null;
  const [day, month] = format === "dmy" ? [pieces[0], pieces[1]] : [pieces[1], pieces[0]];
  const year = pieces[2] < 100 ? 2000 + pieces[2] : pieces[2];
  const [hours = 0, minutes = 0] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours || 0, minutes || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const parseNumber = (value) => {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  // "1.234,50" -> 1234.50 ; "1,234.50" -> 1234.50
  const normalized = /,\d{1,2}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

// Minimal CSV line splitter for previews (quoted fields, doubled quotes).
export function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

// Header + first rows of a CSV text sample.
export function previewCsv(text, maxRows = 10) {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter((line) => line.trim());
  // Unless the sample ends with a newline, its last line may be cut off mid-way.
  const usable = /\n\s*$/.test(clean) ? lines : lines.slice(0, -1);
  const complete = usable.slice(0, maxRows + 1);
  const [headerLine, ...rowLines] = complete.length > 1 ? complete : lines;
  const headers = splitCsvLine(headerLine ?? "", delimiter);
  const rows = rowLines.slice(0, maxRows).map((line) => splitCsvLine(line, delimiter));
  return { delimiter, headers, rows };
}
