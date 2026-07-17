import test from "node:test";
import assert from "node:assert/strict";

import { BUSINESS_RULES, FINAL_HEADERS, FILLS } from "../src/config/business-rules.js";
import {
  applyCustomerCorrection,
  applyReviewDecision,
  buildTruckModel,
  canExport,
  recalculateTruck,
  submitOversizeReview,
} from "../src/engine/truck-model.js";

const baseRecord = (overrides = {}) => ({
  "Delivery Code": 975,
  "SO Cust ID": 200,
  "Load Id": "00042",
  "SO Order Number": 123456,
  "Customer PO": "000123",
  "SO Reference A": "Smith John",
  "SO Reference B": "000987654",
  "Packing Slip ID": "W0001",
  "Actual Ship Date": "7/13/2026",
  "SO Position": 1,
  "SO Sequence": 0,
  "SO Line Item": "GL PN123",
  "SO Line Item Variant": "approved",
  "SO Orig Variant": "001",
  "SO Line Item Description": "GL PN123 54 X 70 x3",
  "Order Qty": 1,
  "Delivered Qty": 1,
  "BO Qty": 0,
  "SO Units": "EA",
  "Floor ID": "101",
  "Component Ordered": "full",
  "Recovery Flag": "False",
  "Serial Numbers": "0000",
  "Barcodes": "0001234567890123456789012345",
  "Carrier": "320OR",
  ...overrides,
});

test("uses the exact final headers in the required order", () => {
  assert.deepEqual(FINAL_HEADERS, [
    "Job Order Number",
    "Customer PO",
    "Name",
    "SO Order Number",
    "Truck Ship Date",
    "SO Line Item",
    "Description",
    "Order Qty",
    "Delivered Qty",
    "BO Qty",
    "Floor ID",
    "Component Ordered",
    "Barcode",
  ]);
});

test("preserves leading zeroes and the complete barcode as strings", () => {
  const model = buildTruckModel([baseRecord()]);
  const row = model.rows[0];
  assert.equal(row.transformed["Customer PO"], "000123");
  assert.equal(row.transformed["SO Order Number"], "000987654");
  assert.equal(row.transformed.Barcode, "0001234567890123456789012345");
  assert.equal(typeof row.transformed.Barcode, "string");
  assert.equal(row.original["Load Id"], "00042");
});

test("applies customer-name corrections across every row in the matching deal", () => {
  const model = buildTruckModel([
    baseRecord({ "SO Position": 1 }),
    baseRecord({ "SO Position": 2, "SO Line Item": "CS 2" }),
    baseRecord({ "Customer PO": "DIFFERENT", "SO Reference A": "Other Person", "SO Position": 3 }),
  ]);
  const corrected = applyCustomerCorrection(model, model.rows[0].id, "Smith,John", true);
  assert.equal(corrected.rows[0].transformed.Name, "Smith,John");
  assert.equal(corrected.rows[1].transformed.Name, "Smith,John");
  assert.notEqual(corrected.rows[2].transformed.Name, "Smith,John");
});

test("flags F nulls always and G nulls only when F is missing", () => {
  const model = buildTruckModel([
    baseRecord({ "SO Reference A": " null ", "SO Reference B": "null", "Floor ID": "null" }),
    baseRecord({ "SO Position": 2, "SO Reference A": "Real Customer", "SO Reference B": "null" }),
    baseRecord({ "SO Position": 3, "SO Reference A": "", "SO Reference B": "null" }),
  ]);
  assert.equal(canExport(model), false);
  assert.equal(model.reviewItems.filter((item) => item.sourceColumn === "SO Reference A").length, 1);
  assert.equal(model.reviewItems.filter((item) => item.sourceColumn === "SO Reference B").length, 2);
  assert.ok(!model.reviewItems.some((item) => item.sourceColumn === "Floor ID"));
  const reviewed = model.reviewItems.reduce(
    (current, item) => applyReviewDecision(current, item.id, { action: "approveBlank" }),
    model,
  );
  assert.equal(canExport(reviewed), false);
  assert.equal(canExport(submitOversizeReview(reviewed, {})), true);
});

test("enforces highlight precedence and exact classification rules", () => {
  const model = buildTruckModel([
    baseRecord({ "Customer PO": "000123S  ", "SO Line Item": "ok interior", "BO Qty": " 1 " }),
    baseRecord({ "SO Position": 2, "SO Line Item": "PTD PANEL", "SO Line Item Description": "PTD 60 X 80", "Component Ordered": "pd_full" }),
    baseRecord({ "SO Position": 3, "SO Line Item": "ED PANEL", "SO Line Item Description": "ED 36 X 80", "Component Ordered": "ed_full" }),
  ]);
  const [service, patio, entry] = model.rows;
  assert.equal(service.classification.isService, true);
  assert.equal(service.classification.isSmallDeal, true);
  assert.equal(service.styles.B, FILLS.serviceYellow);
  assert.equal(service.styles.C, FILLS.smallDealOrange);
  assert.equal(service.styles.F, FILLS.specialInteriorDarkGreen);
  assert.equal(service.styles.J, FILLS.backorderRed);
  assert.equal(patio.styles.G, FILLS.patioDoorBlue);
  assert.equal(entry.styles.G, FILLS.entryDoorLightGreen);
});

test("uses >54 for oversized, never marks exactly 54, and gives purple precedence", () => {
  const model = buildTruckModel([
    baseRecord({ "SO Line Item Description": "GL 54 X 70", "SO Position": 1 }),
    baseRecord({ "SO Line Item Description": "GL 54.01 X 40", "SO Position": 2 }),
    baseRecord({ "SO Line Item": "PTD GL", "SO Line Item Description": "GL PTD 60 X 36", "SO Position": 3 }),
  ]);
  assert.equal(model.rows[0].classification.isOversized, false);
  assert.equal(model.rows[1].classification.isOversized, true);
  assert.match(model.rows[1].transformed.Description, /-OVRSIZE-$/);
  assert.equal(model.rows[2].styles.G, FILLS.oversizedPurple);
  assert.equal((model.rows[2].transformed.Description.match(/-OVRSIZE-/g) ?? []).length, 1);
  assert.equal(BUSINESS_RULES.oversizedWidthThreshold, 54);
});

test("excludes oversized units from standard/misc counts and applies pallet thresholds", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => baseRecord({ "SO Position": index + 1, "SO Line Item Description": `GL ${40 + index} X 60` })),
    baseRecord({ "SO Position": 5, "SO Line Item Description": "GL 60 X 60" }),
    ...Array.from({ length: 5 }, (_, index) => baseRecord({ "Customer PO": "FIVE", "SO Reference A": "Jones Mary", "SO Position": index + 20, "SO Line Item Description": "GL 40 X 60" })),
    ...Array.from({ length: 8 }, (_, index) => baseRecord({ "Customer PO": "EIGHT", "SO Reference A": "Miller Adam", "SO Position": index + 40, "SO Line Item Description": "GL 40 X 60" })),
  ];
  const summary = recalculateTruck(buildTruckModel(rows)).palletSummary;
  const first = summary.deals.find((deal) => deal.customerPO === "000123");
  assert.equal(first.standardWindowCount, 4);
  assert.equal(first.oversizedUnitCount, 1);
  assert.equal(first.assignment, "Misc");
  assert.equal(summary.miscWindows, 4);
  assert.equal(summary.deals.find((deal) => deal.customerPO === "FIVE").dedicatedPallets, 1);
  assert.equal(summary.deals.find((deal) => deal.customerPO === "EIGHT").dedicatedPallets, 2);
});

test("counts one patio door from each pd-full component row and primary entry-door units only", () => {
  const model = buildTruckModel([
    baseRecord({ "SO Position": 1, "SO Line Item": "PTD PANEL", "Component Ordered": "pd_full", "Order Qty": 1 }),
    baseRecord({ "SO Position": 2, "SO Line Item": "PTD FRAME", "Component Ordered": "frame", "Order Qty": 1 }),
    baseRecord({ "SO Position": 3, "SO Line Item": "PTD PANEL", "Component Ordered": "PD-FULL", "Order Qty": 2 }),
    baseRecord({ "SO Position": 4, "SO Line Item": "ED UNIT", "Component Ordered": "pku", "Order Qty": 1 }),
    baseRecord({ "SO Position": 5, "SO Line Item": "ED FRAME", "Component Ordered": "pkf", "Order Qty": 1 }),
    baseRecord({ "SO Position": 6, "SO Line Item": "ED TRIM", "Component Ordered": "ikt", "Order Qty": 1 }),
  ]);
  assert.equal(model.palletSummary.patioDoorTotal, 3);
  assert.equal(model.palletSummary.entryDoorTotal, 2);
});

test("requires a submitted width review and rejects blank window measurements", () => {
  const model = buildTruckModel([
    baseRecord({ "SO Position": 1, "SO Line Item Description": "GL 54 X 70" }),
    baseRecord({ "SO Position": 2, "SO Line Item Description": "GL SIZE UNKNOWN" }),
  ]);
  assert.equal(model.reviewItems.length, 0);
  assert.equal(canExport(model), false);
  assert.equal(model.rows[0].classification.extractedWidth, 54);
  assert.equal(model.rows[1].classification.extractedWidth, null);
  assert.throws(() => submitOversizeReview(model, {}), /measurement/i);

  const reviewed = submitOversizeReview(model, { [model.rows[1].id]: "60" });
  assert.equal(reviewed.oversizeReviewStatus, "approved");
  assert.equal(reviewed.rows[0].classification.isOversized, false);
  assert.equal(reviewed.rows[1].classification.extractedWidth, 60);
  assert.equal(reviewed.rows[1].classification.isOversized, true);
  assert.equal(canExport(reviewed), true);
});
