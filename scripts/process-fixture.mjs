import fs from "node:fs/promises";
import path from "node:path";

import { importRawWorkbook } from "../src/engine/importer.js";
import { approveAllPendingAsBlank, canExport } from "../src/engine/truck-model.js";
import { exportInventoryWorkbook } from "../src/export/excel.js";
import { exportPalletPdf, exportTruckListPdf } from "../src/export/pdf.js";

const root = process.cwd();
const sourcePath = path.join(root, "reference-files", "PackingListRAW DATA (1).xlsx");
const outputDir = path.join(root, "output", "fixture");
const source = await fs.readFile(sourcePath);
let model = await importRawWorkbook(source);
const pendingBeforeApproval = model.reviewItems.filter((item) => item.status === "pending").length;
model = approveAllPendingAsBlank(model);
if (!canExport(model)) throw new Error("Fixture review did not reach an exportable state.");

await fs.mkdir(outputDir, { recursive: true });
const outputs = [
  await exportInventoryWorkbook(model),
  await exportTruckListPdf(model),
  await exportPalletPdf(model),
];
for (const output of outputs) await fs.writeFile(path.join(outputDir, output.fileName), output.bytes);
await fs.writeFile(path.join(outputDir, "audit-summary.json"), JSON.stringify({
  sourceFile: path.basename(sourcePath),
  rows: model.rows.length,
  reportDate: model.reportDate,
  warnings: model.warnings,
  pendingBeforeApproval,
  approvalMode: "Explicit fixture-run approval as blank",
  palletSummary: model.palletSummary,
  outputs: outputs.map((output) => output.fileName),
}, null, 2));

console.log(JSON.stringify({
  rows: model.rows.length,
  reportDate: model.reportDate,
  warnings: model.warnings,
  pendingBeforeApproval,
  summary: {
    dedicatedPallets: model.palletSummary.dedicatedPallets,
    miscWindows: model.palletSummary.miscWindows,
    oversizedUnits: model.palletSummary.oversizedUnits,
    totalWindows: model.palletSummary.totalWindows,
  },
  outputs: outputs.map((output) => path.join(outputDir, output.fileName)),
}, null, 2));
