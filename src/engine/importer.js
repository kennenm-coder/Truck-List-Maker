import JSZip from "jszip";

import { SOURCE_HEADERS } from "../config/business-rules.js";
import { buildTruckModel } from "./truck-model.js";

const normalizeHeader = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attribute(tag, name) {
  return decodeXml(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "");
}

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    [...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((text) => decodeXml(text[1])).join(""),
  );
}

function columnIndex(address) {
  const letters = address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function parseSheet(xml, strings) {
  const rows = new Map();
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(attribute(rowMatch[1], "r")) || rows.size + 1;
    const cells = new Map();
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const cellTag = cellMatch[1];
      const content = cellMatch[2];
      const address = attribute(cellTag, "r");
      const type = attribute(cellTag, "t");
      let value = null;
      if (type === "inlineStr") {
        value = [...content.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) => decodeXml(match[1])).join("");
      } else {
        const raw = content.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        if (raw != null) value = type === "s" ? strings[Number(raw)] ?? "" : decodeXml(raw);
      }
      if (address) cells.set(columnIndex(address), value);
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

function normalizeTarget(target) {
  const clean = target.replace(/^\//, "").replaceAll("\\", "/");
  return clean.startsWith("xl/") ? clean : `xl/${clean.replace(/^\.\.\//, "")}`;
}

async function workbookSheets(zip) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const relationshipsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  if (!workbookXml || !relationshipsXml) throw new Error("The file is not a readable Excel workbook.");
  const relationships = new Map([...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)].map((match) => [attribute(match[1], "Id"), normalizeTarget(attribute(match[1], "Target"))]));
  return [...workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>(?:<\/(?:\w+:)?sheet>)?/g)].map((match) => ({
    name: attribute(match[1], "name"),
    path: relationships.get(attribute(match[1], "r:id")),
  })).filter((sheet) => sheet.path);
}

function findGrid(sheets) {
  for (const sheet of sheets) {
    for (let rowNumber = 1; rowNumber <= 20; rowNumber += 1) {
      const row = sheet.rows.get(rowNumber);
      if (!row) continue;
      const byHeader = new Map([...row.entries()].map(([column, value]) => [normalizeHeader(value), column]));
      const missing = SOURCE_HEADERS.filter((header) => !byHeader.has(normalizeHeader(header)));
      if (!missing.length) return { ...sheet, headerRow: rowNumber, byHeader };
    }
  }
  throw new Error(`No worksheet contains all required source headers: ${SOURCE_HEADERS.join(", ")}`);
}

export async function importRawWorkbook(input, options = {}) {
  const bytes = input instanceof ArrayBuffer || ArrayBuffer.isView(input) ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  const stringXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const strings = sharedStrings(stringXml);
  const sheets = [];
  for (const descriptor of await workbookSheets(zip)) {
    const xml = await zip.file(descriptor.path)?.async("text");
    if (xml) sheets.push({ name: descriptor.name, rows: parseSheet(xml, strings) });
  }
  const { rows, headerRow, byHeader } = findGrid(sheets);
  const records = [];
  const lastRow = Math.max(...rows.keys());
  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = rows.get(rowNumber) ?? new Map();
    const record = Object.fromEntries(SOURCE_HEADERS.map((header) => [header, row.get(byHeader.get(normalizeHeader(header))) ?? null]));
    if (Object.values(record).every((value) => value == null || String(value).trim() === "")) continue;
    records.push(record);
  }
  if (!records.length) throw new Error("The source workbook contains headers but no data rows.");
  return buildTruckModel(records, options);
}
