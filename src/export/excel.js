import ExcelJS from "exceljs";

import { FINAL_HEADERS } from "../config/business-rules.js";
import { canExport } from "../engine/truck-model.js";

const argb = (hex) => `FF${hex.replace("#", "").toUpperCase()}`;

export async function exportInventoryWorkbook(model) {
  if (!canExport(model)) throw new Error("Complete exception and oversized-measurement review before export.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Truck List Maker";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Inventory Upload", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.addRow(FINAL_HEADERS);
  for (const row of model.rows) {
    sheet.addRow(FINAL_HEADERS.map((header) => {
      const value = row.transformed[header];
      return value === "" || value == null ? null : value;
    }));
  }
  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: "FF17324D" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8EEF0" } };
  header.alignment = { vertical: "middle", wrapText: true };
  sheet.autoFilter = { from: "A1", to: "M1" };
  const widths = [18, 18, 24, 18, 16, 24, 62, 12, 14, 10, 16, 20, 34];
  sheet.columns.forEach((column, index) => {
    column.width = widths[index];
    if ([0, 1, 3, 5, 12].includes(index)) column.numFmt = "@";
  });
  model.rows.forEach((row, index) => {
    const excelRow = index + 2;
    for (const [columnLetter, fill] of Object.entries(row.styles)) {
      sheet.getCell(`${columnLetter}${excelRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(fill) } };
    }
    sheet.getCell(`M${excelRow}`).numFmt = "@";
  });
  sheet.getColumn(7).alignment = { wrapText: true, vertical: "top" };
  sheet.pageSetup.printArea = `A1:M${model.rows.length + 1}`;
  const bytes = await workbook.xlsx.writeBuffer();
  return {
    bytes: new Uint8Array(bytes),
    fileName: `Inventory Upload ${model.reportDate.replaceAll("/", "-")}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    manifest: { rows: model.rows.map((row) => ({ ...row.classification })) },
  };
}
