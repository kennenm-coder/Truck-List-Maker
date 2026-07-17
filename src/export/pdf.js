import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { FINAL_HEADERS } from "../config/business-rules.js";
import { canExport } from "../engine/truck-model.js";

const PAGE_MARGIN = 24;

function color(hex) {
  const value = hex.replace("#", "");
  return rgb(Number.parseInt(value.slice(0, 2), 16) / 255, Number.parseInt(value.slice(2, 4), 16) / 255, Number.parseInt(value.slice(4, 6), 16) / 255);
}

function fit(text, maxCharacters) {
  const value = String(text ?? "");
  return value.length > maxCharacters ? `${value.slice(0, Math.max(1, maxCharacters - 1))}…` : value;
}

function drawCell(page, font, text, x, y, width, height, options = {}) {
  if (options.fill) page.drawRectangle({ x, y, width, height, color: color(options.fill) });
  page.drawRectangle({ x, y, width, height, borderColor: rgb(0.78, 0.82, 0.85), borderWidth: 0.35 });
  page.drawText(fit(text, options.maxCharacters ?? 18), {
    x: x + 2,
    y: y + height / 2 - (options.fontSize ?? 6) / 2,
    size: options.fontSize ?? 6,
    font,
    color: options.textColor ?? rgb(0.08, 0.15, 0.2),
  });
}

export async function exportTruckListPdf(model) {
  if (!canExport(model)) throw new Error("Complete exception and oversized-measurement review before export.");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = [792, 612];
  const widths = [42, 48, 68, 52, 45, 76, 205, 28, 28, 25, 38, 45, 70];
  const scale = (size[0] - PAGE_MARGIN * 2) / widths.reduce((sum, width) => sum + width, 0);
  const scaled = widths.map((width) => width * scale);
  const rowHeight = 14;
  const headerHeight = 20;
  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage(size);
    page.drawRectangle({ x: 0, y: 0, width: size[0], height: size[1], color: rgb(1, 1, 1) });
    page.drawText(`Truck List - ${model.reportDate}`, { x: PAGE_MARGIN, y: size[1] - 24, font: bold, size: 14, color: rgb(0.06, 0.25, 0.33) });
    y = size[1] - 50;
    let x = PAGE_MARGIN;
    FINAL_HEADERS.forEach((header, index) => {
      drawCell(page, bold, header, x, y, scaled[index], headerHeight, { fill: "#D8EEF0", fontSize: 5.5, maxCharacters: 20 });
      x += scaled[index];
    });
    y -= rowHeight;
  };
  newPage();
  model.rows.forEach((row) => {
    if (y < PAGE_MARGIN) newPage();
    let x = PAGE_MARGIN;
    FINAL_HEADERS.forEach((header, index) => {
      const columnLetter = String.fromCharCode(65 + index);
      drawCell(page, regular, row.transformed[header], x, y, scaled[index], rowHeight, {
        fill: row.styles[columnLetter],
        maxCharacters: header === "Description" ? 42 : 16,
      });
      x += scaled[index];
    });
    y -= rowHeight;
  });
  const bytes = await pdf.save();
  return {
    bytes,
    fileName: `Truck List ${model.reportDate.replaceAll("/", "-")}.pdf`,
    mimeType: "application/pdf",
    manifest: { rows: model.rows.map((row) => ({ ...row.classification })) },
  };
}

export async function exportPalletPdf(model) {
  if (!canExport(model)) throw new Error("Complete exception and oversized-measurement review before export.");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [612, 792];
  const widths = [155, 100, 95, 85, 105];
  const headers = ["Customer Name", "Customer PO", "Standard Windows", "Oversized Units", "Pallet Assignment"];
  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage(pageSize);
    page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: rgb(1, 1, 1) });
    page.drawText(`Pallet Requirements - ${model.reportDate}`, { x: PAGE_MARGIN, y: 755, font: bold, size: 16, color: rgb(0.06, 0.25, 0.33) });
    y = 720;
    let x = PAGE_MARGIN;
    headers.forEach((header, index) => {
      drawCell(page, bold, header, x, y, widths[index], 22, { fill: "#D8EEF0", fontSize: 7, maxCharacters: 24 });
      x += widths[index];
    });
    y -= 17;
  };
  newPage();
  for (const deal of model.palletSummary.deals) {
    if (y < 100) newPage();
    let x = PAGE_MARGIN;
    [deal.customerName, deal.customerPO, deal.standardWindowCount, deal.oversizedUnitCount, deal.assignment].forEach((value, index) => {
      drawCell(page, regular, value, x, y, widths[index], 17, { fontSize: 7, maxCharacters: 26 });
      x += widths[index];
    });
    y -= 17;
  }
  const summaryY = Math.max(35, y - 92);
  page.drawRectangle({ x: PAGE_MARGIN, y: summaryY, width: 360, height: 80, color: color("#EEF6F7"), borderColor: color("#9BBCC2"), borderWidth: 1 });
  const summaryLines = [
    `Dedicated Pallets: ${model.palletSummary.dedicatedPallets}`,
    `Misc Windows: ${model.palletSummary.miscWindows}`,
    `Oversized Units Requiring Special Placement: ${model.palletSummary.oversizedUnits}`,
    `Total Windows: ${model.palletSummary.totalWindows}`,
    `Patio Doors: ${model.palletSummary.patioDoorTotal}`,
    `Entry Doors: ${model.palletSummary.entryDoorTotal}`,
  ];
  summaryLines.forEach((line, index) => page.drawText(line, { x: PAGE_MARGIN + 10, y: summaryY + 66 - index * 12, font: index === 0 ? bold : regular, size: 9 }));
  const bytes = await pdf.save();
  return {
    bytes,
    fileName: `Pallet Requirements ${model.reportDate.replaceAll("/", "-")}.pdf`,
    mimeType: "application/pdf",
    manifest: { summary: structuredClone(model.palletSummary) },
  };
}
