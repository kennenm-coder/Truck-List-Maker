import { canExport } from "./truck-model.js";

export function buildPreviewModel(model) {
  return {
    reportDate: model.reportDate,
    warnings: [...model.warnings],
    canExport: canExport(model),
    pendingReviewCount: model.reviewItems.filter((item) => item.status === "pending").length,
    oversizeReviewComplete: model.oversizeReviewStatus === "approved",
    pendingMeasurementCount: model.rows.filter((row) => row.classification.isWindow && row.classification.extractedWidth == null).length,
    headers: [...model.finalHeaders],
    rows: model.rows.map((row) => ({
      id: row.id,
      sourceRow: row.sourceRow,
      values: { ...row.transformed },
      classification: { ...row.classification },
      styles: { ...row.styles },
    })),
    palletSummary: structuredClone(model.palletSummary),
  };
}
