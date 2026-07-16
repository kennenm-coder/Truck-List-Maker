import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { FILLS } from "../src/config/business-rules.js";
import { buildPreviewModel } from "../src/engine/preview.js";
import { buildTruckModel } from "../src/engine/truck-model.js";
import { exportInventoryWorkbook } from "../src/export/excel.js";
import { exportPalletPdf, exportTruckListPdf } from "../src/export/pdf.js";

const records = [{
  "Delivery Code": 975,
  "SO Cust ID": 200,
  "Load Id": "0001",
  "SO Order Number": "0000123",
  "Customer PO": "PO1S",
  "SO Reference A": "Smith John",
  "SO Reference B": "000456",
  "Packing Slip ID": "W1",
  "Actual Ship Date": "7/13/2026",
  "SO Position": 1,
  "SO Sequence": 0,
  "SO Line Item": "GL PN1",
  "SO Line Item Variant": "reviewed",
  "SO Orig Variant": "1",
  "SO Line Item Description": "GL PN1 60 X 40",
  "Order Qty": 1,
  "Delivered Qty": 1,
  "BO Qty": 1,
  "SO Units": "EA",
  "Floor ID": "101",
  "Component Ordered": "full",
  "Recovery Flag": "False",
  "Serial Numbers": "0",
  "Barcodes": "00012345678901234567890",
  "Carrier": "320OR",
}];

test("Excel and both PDFs render the same classifications as the web preview", async () => {
  const model = buildTruckModel(records);
  const preview = buildPreviewModel(model);
  const excel = await exportInventoryWorkbook(model);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel.bytes);
  const sheet = workbook.getWorksheet("Inventory Upload");
  assert.equal(sheet.getCell("M2").text, "00012345678901234567890");
  assert.equal(sheet.getCell("B2").fill.fgColor.argb, FILLS.serviceYellow.replace("#", "FF"));
  assert.equal(sheet.getCell("G2").fill.fgColor.argb, FILLS.oversizedPurple.replace("#", "FF"));
  assert.deepEqual(excel.manifest.rows, preview.rows.map((row) => row.classification));

  const truckPdf = await exportTruckListPdf(model);
  const palletPdf = await exportPalletPdf(model);
  assert.ok(truckPdf.bytes.length > 500);
  assert.ok(palletPdf.bytes.length > 500);
  assert.deepEqual(truckPdf.manifest.rows, preview.rows.map((row) => row.classification));
  assert.deepEqual(palletPdf.manifest.summary, preview.palletSummary);
});
