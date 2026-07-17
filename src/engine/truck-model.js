import {
  BUSINESS_RULES,
  COLUMN_MAPPING,
  FILLS,
  FINAL_HEADERS,
  SOURCE_HEADERS,
  SOURCE_TO_FINAL,
} from "../config/business-rules.js";
import { extractWidth, parseMeasurementToken } from "./measurements.js";

const QUANTITY_HEADERS = new Set(["Order Qty", "Delivered Qty", "BO Qty"]);

const clone = (value) => structuredClone(value);
const asText = (value) => (value == null ? "" : String(value));
const normalizedText = (value) => asText(value).trim();

export function isBlankEquivalent(value, rules = BUSINESS_RULES) {
  return rules.nullReviewTokens.includes(normalizedText(value).toLowerCase());
}

function isPlaceholderCustomer(value, rules) {
  const normalized = normalizedText(value).toLowerCase();
  return rules.placeholderCustomerTokens.some((token) => normalized.includes(token));
}

function numericQuantity(value) {
  if (!normalizedText(value) || isBlankEquivalent(value)) return null;
  const parsed = Number(normalizedText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanCustomerName(value) {
  const text = normalizedText(value);
  if (!text) return "";
  const withoutNote = text.split(":", 1)[0].trim();
  const words = withoutNote.replace(/[;,]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2) return withoutNote;
  return `${words[0]},${words[1]}`;
}

function mapTransformed(working) {
  return Object.fromEntries(FINAL_HEADERS.map((header) => {
    const sourceHeader = COLUMN_MAPPING[header];
    const sourceValue = working[sourceHeader];
    if (QUANTITY_HEADERS.has(header)) return [header, numericQuantity(sourceValue)];
    if (header === "Name") return [header, cleanCustomerName(sourceValue)];
    return [header, asText(sourceValue)];
  }));
}

function productAllowsOversize(row, rules) {
  const productText = `${row.transformed["SO Line Item"]} ${row.transformed.Description}`.toUpperCase();
  if (rules.oversizedWindowExclusions.some((token) => productText.includes(token))) return false;
  return rules.oversizedWindowTokens.some((token) => productText.includes(token));
}

function isWindow(row, rules) {
  const component = normalizedText(row.transformed["Component Ordered"]).toLowerCase();
  return rules.windowComponentTokens.some((token) => component === token.toLowerCase());
}

function normalizedComponent(value) {
  return normalizedText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPatioDoorUnit(row, rules) {
  const component = normalizedComponent(row.transformed["Component Ordered"]);
  return rules.patioDoorComponentTokens.some((token) => component === normalizedComponent(token));
}

function isEntryDoorUnit(row, rules) {
  const lineItem = normalizedText(row.transformed["SO Line Item"]).toUpperCase();
  const component = normalizedComponent(row.transformed["Component Ordered"]);
  return lineItem.startsWith("ED") && rules.entryDoorComponentTokens.some((token) => component === normalizedComponent(token));
}

function unitQuantity(row) {
  const quantity = numericQuantity(row.transformed["Order Qty"]);
  return quantity == null ? 1 : Math.max(0, quantity);
}

function ensureOversizeToken(description, oversized, rules) {
  const clean = asText(description).trim();
  if (!oversized) return clean;
  if (rules.recognizedOversizeTokens.some((token) => clean.toUpperCase().includes(token))) return clean;
  return `${clean}${clean ? " " : ""}-OVRSIZE-`;
}

function dealKey(row) {
  return `${normalizedText(row.transformed["Customer PO"]).toUpperCase()}\u001f${normalizedText(row.transformed.Name).toUpperCase()}`;
}

function reviewItem(row, sourceColumn, kind, originalValue) {
  return {
    id: `${row.id}:${sourceColumn}:${kind}`,
    rowId: row.id,
    sourceRow: row.sourceRow,
    sourceColumn,
    finalColumn: SOURCE_TO_FINAL[sourceColumn] ?? null,
    kind,
    originalValue: originalValue == null ? null : asText(originalValue),
    status: "pending",
    action: null,
    replacement: "",
  };
}

function buildReviewItems(rows, rules) {
  const items = [];
  for (const row of rows) {
    const columnF = row.original["SO Reference A"];
    const columnG = row.original["SO Reference B"];
    const columnFIsMissing = !normalizedText(columnF) || isBlankEquivalent(columnF, rules);
    if (isBlankEquivalent(columnF, rules)) {
      items.push(reviewItem(row, "SO Reference A", "nullToken", columnF));
    }
    if (isBlankEquivalent(columnG, rules) && columnFIsMissing) {
      items.push(reviewItem(row, "SO Reference B", "nullToken", columnG));
    }
    if (isPlaceholderCustomer(row.original["SO Reference A"], rules)) {
      items.push(reviewItem(row, "SO Reference A", "placeholderCustomer", row.original["SO Reference A"]));
    }
  }
  return items;
}

function classifyRows(rows, rules) {
  const counts = new Map();
  for (const row of rows) counts.set(dealKey(row), (counts.get(dealKey(row)) ?? 0) + 1);

  return rows.map((sourceRow) => {
    const row = clone(sourceRow);
    const customerPO = normalizedText(row.transformed["Customer PO"]);
    const soLineItem = normalizedText(row.transformed["SO Line Item"]);
    if (!("reviewedWidth" in row)) row.reviewedWidth = extractWidth(row.transformed.Description);
    const width = row.reviewedWidth;
    const window = isWindow(row, rules);
    const oversized = window && productAllowsOversize(row, rules) && width != null && width > rules.oversizedWidthThreshold;
    row.transformed.Description = ensureOversizeToken(row.transformed.Description, oversized, rules);
    const upperLineItem = soLineItem.toUpperCase();
    const classification = {
      dealUnitCount: counts.get(dealKey(row)) ?? 0,
      isSmallDeal: (counts.get(dealKey(row)) ?? 0) <= rules.smallDealMaximumUnits,
      isService: customerPO.trim().toUpperCase().endsWith("S"),
      hasSpecialInterior: upperLineItem.includes("PN") || upperLineItem.includes("OK"),
      isPatioDoor: upperLineItem.includes("PTD"),
      isEntryDoor: upperLineItem.trimStart().startsWith("ED"),
      isPatioDoorUnit: isPatioDoorUnit(row, rules),
      isEntryDoorUnit: isEntryDoorUnit(row, rules),
      isBackordered: numericQuantity(row.transformed["BO Qty"]) === 1,
      isWindow: window,
      extractedWidth: width,
      isOversized: oversized,
    };
    const styles = {};
    if (classification.isService) styles.B = FILLS.serviceYellow;
    else if (classification.isSmallDeal) styles.B = FILLS.smallDealOrange;
    if (classification.isSmallDeal) styles.C = FILLS.smallDealOrange;
    if (classification.hasSpecialInterior) styles.F = FILLS.specialInteriorDarkGreen;
    if (classification.isOversized) styles.G = FILLS.oversizedPurple;
    else if (classification.isPatioDoor) styles.G = FILLS.patioDoorBlue;
    else if (classification.isEntryDoor) styles.G = FILLS.entryDoorLightGreen;
    if (classification.isBackordered) styles.J = FILLS.backorderRed;
    row.classification = classification;
    row.styles = styles;
    return row;
  });
}

function calculatePalletSummary(rows, rules) {
  const deals = new Map();
  for (const row of rows) {
    if (!row.classification.isWindow) continue;
    const key = dealKey(row);
    if (!deals.has(key)) {
      deals.set(key, {
        customerName: row.transformed.Name,
        customerPO: row.transformed["Customer PO"],
        standardWindowCount: 0,
        oversizedUnitCount: 0,
        dedicatedPallets: 0,
        assignment: "",
      });
    }
    const deal = deals.get(key);
    if (row.classification.isOversized) deal.oversizedUnitCount += 1;
    else deal.standardWindowCount += 1;
  }

  const dealList = [...deals.values()].map((deal) => {
    if (deal.standardWindowCount === 0) return deal;
    if (deal.standardWindowCount < rules.dedicatedPalletMinimumWindows) {
      deal.assignment = "Misc";
      return deal;
    }
    deal.dedicatedPallets = Math.ceil(deal.standardWindowCount / rules.dedicatedPalletCapacity);
    deal.assignment = `${deal.dedicatedPallets} Pallet${deal.dedicatedPallets === 1 ? "" : "s"}`;
    return deal;
  });

  return {
    deals: dealList,
    dedicatedPallets: dealList.reduce((sum, deal) => sum + deal.dedicatedPallets, 0),
    miscWindows: dealList.reduce((sum, deal) => sum + (deal.assignment === "Misc" ? deal.standardWindowCount : 0), 0),
    oversizedUnits: dealList.reduce((sum, deal) => sum + deal.oversizedUnitCount, 0),
    totalWindows: dealList.reduce((sum, deal) => sum + deal.standardWindowCount + deal.oversizedUnitCount, 0),
    patioDoorTotal: rows.reduce((sum, row) => sum + (row.classification.isPatioDoorUnit ? unitQuantity(row) : 0), 0),
    entryDoorTotal: rows.reduce((sum, row) => sum + (row.classification.isEntryDoorUnit ? unitQuantity(row) : 0), 0),
  };
}

function parseDateValue(value) {
  const parsed = new Date(normalizedText(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function reportMetadata(rows) {
  const truckDates = [...new Set(rows.map((row) => normalizedText(row.working["Actual Ship Date"])).filter(Boolean))];
  const parsed = truckDates.map((date) => ({ date, parsed: parseDateValue(date) })).filter((item) => item.parsed);
  parsed.sort((a, b) => b.parsed - a.parsed);
  const loadIds = [...new Set(rows.map((row) => normalizedText(row.working["Load Id"])).filter(Boolean))];
  const warnings = [];
  if (truckDates.length > 1) warnings.push(`Conflicting truck dates detected: ${truckDates.join(", ")}.`);
  return { truckDates, loadIds, reportDate: parsed[0]?.date ?? truckDates[0] ?? "Undated", warnings };
}

export function recalculateTruck(model, rules = model.rules ?? BUSINESS_RULES) {
  const next = clone(model);
  if (Array.isArray(next.reviewItems)) next.reviewItems = next.reviewItems.filter((item) => item.kind !== "measurement");
  next.rules = clone(rules);
  next.rows = classifyRows(next.rows.map((row) => ({ ...row, transformed: mapTransformed(row.working) })), rules);
  next.palletSummary = calculatePalletSummary(next.rows, rules);
  next.oversizeReviewStatus = next.oversizeReviewStatus === "approved" ? "approved" : "pending";
  Object.assign(next, reportMetadata(next.rows));
  return next;
}

export function buildTruckModel(rawRecords, options = {}) {
  const rules = options.rules ?? BUSINESS_RULES;
  const rows = rawRecords.map((record, index) => {
    const original = Object.fromEntries(SOURCE_HEADERS.map((header) => [header, record[header] ?? null]));
    const working = clone(original);
    return {
      id: `source-row-${index + 2}`,
      sourceRow: index + 2,
      original,
      working,
      transformed: mapTransformed(working),
      reviewedWidth: extractWidth(working["SO Line Item Description"]),
      classification: {},
      styles: {},
    };
  });
  let model = {
    rules: clone(rules),
    rows,
    reviewItems: [],
    palletSummary: null,
    sourceHeaders: [...SOURCE_HEADERS],
    finalHeaders: [...FINAL_HEADERS],
    oversizeReviewStatus: "pending",
  };
  model = recalculateTruck(model, rules);
  model.reviewItems = buildReviewItems(model.rows, rules);
  return model;
}

export function canExport(model) {
  return model.reviewItems.every((item) => item.status !== "pending") && model.oversizeReviewStatus === "approved";
}

export function submitOversizeReview(model, widthByRowId = {}) {
  const next = clone(model);
  for (const row of next.rows) {
    if (!row.classification.isWindow) continue;
    if (Object.hasOwn(widthByRowId, row.id)) {
      row.reviewedWidth = parseMeasurementToken(widthByRowId[row.id]);
    }
  }
  const unresolved = next.rows.filter((row) => row.classification.isWindow && row.reviewedWidth == null);
  if (unresolved.length) {
    throw new Error(`${unresolved.length} window measurement${unresolved.length === 1 ? " is" : "s are"} still blank.`);
  }
  next.oversizeReviewStatus = "approved";
  return recalculateTruck(next);
}

export function applyReviewDecision(model, reviewId, decision) {
  const next = clone(model);
  const item = next.reviewItems.find((candidate) => candidate.id === reviewId);
  if (!item) throw new Error(`Unknown review item: ${reviewId}`);
  const row = next.rows.find((candidate) => candidate.id === item.rowId);
  if (!row) throw new Error(`Review row no longer exists: ${item.rowId}`);
  if (decision.action === "correct") {
    row.working[item.sourceColumn] = decision.replacement ?? "";
    item.status = "corrected";
    item.action = "correct";
    item.replacement = asText(decision.replacement);
  } else if (decision.action === "approveBlank") {
    row.working[item.sourceColumn] = "";
    item.status = "approved";
    item.action = "approveBlank";
    item.replacement = "";
  } else {
    throw new Error(`Unsupported review action: ${decision.action}`);
  }
  const recalculated = recalculateTruck(next);
  recalculated.reviewItems = next.reviewItems;
  return recalculated;
}

export function approveAllPendingAsBlank(model) {
  const next = clone(model);
  for (const item of next.reviewItems) {
    if (item.status !== "pending") continue;
    const row = next.rows.find((candidate) => candidate.id === item.rowId);
    if (row) row.working[item.sourceColumn] = "";
    item.status = "approved";
    item.action = "approveBlank";
    item.replacement = "";
  }
  const recalculated = recalculateTruck(next);
  recalculated.reviewItems = next.reviewItems;
  return recalculated;
}

function matchingDealRows(rows, sourceRow) {
  const priority = ["Customer PO", "SO Order Number", "SO Reference B"];
  const matchColumn = priority.find((column) => normalizedText(sourceRow.working[column]));
  if (!matchColumn) return [sourceRow.id];
  const matchValue = normalizedText(sourceRow.working[matchColumn]).toUpperCase();
  return rows.filter((row) => normalizedText(row.working[matchColumn]).toUpperCase() === matchValue).map((row) => row.id);
}

export function applyCustomerCorrection(model, rowId, customerName, applyAcrossDeal = true) {
  const next = clone(model);
  const sourceRow = next.rows.find((row) => row.id === rowId);
  if (!sourceRow) throw new Error(`Unknown source row: ${rowId}`);
  const rowIds = new Set(applyAcrossDeal ? matchingDealRows(next.rows, sourceRow) : [rowId]);
  for (const row of next.rows) {
    if (rowIds.has(row.id)) row.working["SO Reference A"] = customerName;
  }
  for (const item of next.reviewItems) {
    if (rowIds.has(item.rowId) && item.sourceColumn === "SO Reference A") {
      item.status = "corrected";
      item.action = "correct";
      item.replacement = customerName;
    }
  }
  const recalculated = recalculateTruck(next);
  recalculated.reviewItems = next.reviewItems;
  return recalculated;
}
