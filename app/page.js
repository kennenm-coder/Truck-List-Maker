"use client";

import { useEffect, useMemo, useState } from "react";

import { FILLS } from "../src/config/business-rules.js";
import { importRawWorkbook } from "../src/engine/importer.js";
import { buildPreviewModel } from "../src/engine/preview.js";
import { applyCustomerCorrection, applyReviewDecision, approveAllPendingAsBlank } from "../src/engine/truck-model.js";
import { exportInventoryWorkbook } from "../src/export/excel.js";
import { exportPalletPdf, exportTruckListPdf } from "../src/export/pdf.js";
import { clearActiveTruck, loadActiveTruck, saveActiveTruck } from "../src/storage/truck-session.js";

const TABS = ["Review", "Truck list", "Pallets"];

function saveFile(result) {
  const blob = new Blob([result.bytes], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Stat({ label, value, tone = "" }) {
  return <div className={`stat ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyState({ onUpload, busy }) {
  return (
    <section className="empty-state">
      <div className="upload-mark">TL</div>
      <p className="eyebrow">One workbook. One truck.</p>
      <h2>Turn raw packing data into a reviewed truck list.</h2>
      <p>Upload the raw Excel workbook. The app preserves identifiers, applies the column F/G null-review rules, recalculates classifications, and prepares all three required outputs.</p>
      <label className={`upload-button ${busy ? "disabled" : ""}`}>
        {busy ? "Reading workbook…" : "Choose raw Excel file"}
        <input type="file" accept=".xlsx" onChange={onUpload} disabled={busy} />
      </label>
      <div className="file-hint">.xlsx · processed in your browser · nothing is uploaded to a server</div>
    </section>
  );
}

function ReviewPanel({ model, setModel }) {
  const pending = model.reviewItems.filter((item) => item.status === "pending");
  const [drafts, setDrafts] = useState({});
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? pending : pending.slice(0, 40);

  const decide = (item, action) => {
    const replacement = drafts[item.id] ?? "";
    if (action === "correct" && !replacement.trim()) return;
    if (item.sourceColumn === "SO Reference A" && action === "correct") {
      setModel(applyCustomerCorrection(model, item.rowId, replacement, true));
    } else {
      setModel(applyReviewDecision(model, item.id, { action, replacement }));
    }
  };

  const approveAll = () => {
    setModel(approveAllPendingAsBlank(model));
  };

  if (!pending.length) {
    return <div className="complete-card"><span>✓</span><div><strong>Review complete</strong><p>Every blank or placeholder has a recorded decision. Exports are unlocked.</p></div></div>;
  }

  return (
    <div className="review-stack">
      <div className="panel-heading">
        <div><p className="eyebrow">Blocking review</p><h2>{pending.length.toLocaleString()} decisions remaining</h2></div>
        <button className="button secondary danger" onClick={approveAll}>Approve all as blank</button>
      </div>
      <p className="panel-note">Column F nulls are always reviewed. Column G nulls are reviewed only when F is missing. Empty cells and nulls in other columns are allowed. Customer-name corrections apply across the matching deal.</p>
      <div className="review-list">
        {visible.map((item) => {
          const row = model.rows.find((candidate) => candidate.id === item.rowId);
          return (
            <article className="review-card" key={item.id}>
              <div className="review-context">
                <span>Source row {item.sourceRow}</span>
                <strong>{item.sourceColumn}</strong>
                <small>{row?.transformed["Customer PO"] || "No PO"} · {row?.transformed.Name || "No customer"}</small>
              </div>
              <div className="original-value"><span>Original</span><code>{item.originalValue || "blank"}</code></div>
              <input aria-label={`Replacement for ${item.sourceColumn} row ${item.sourceRow}`} value={drafts[item.id] ?? ""} placeholder="Enter correction" onChange={(event) => setDrafts({ ...drafts, [item.id]: event.target.value })} />
              <button className="button compact" onClick={() => decide(item, "correct")}>Save correction</button>
              <button className="text-button" onClick={() => decide(item, "approveBlank")}>Approve as blank</button>
            </article>
          );
        })}
      </div>
      {!showAll && pending.length > visible.length && <button className="button secondary load-more" onClick={() => setShowAll(true)}>Show all {pending.length.toLocaleString()} items</button>}
    </div>
  );
}

function TruckTable({ preview }) {
  return (
    <div className="table-shell">
      <table>
        <thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{preview.rows.map((row) => <tr key={row.id}>{preview.headers.map((header, index) => {
          const letter = String.fromCharCode(65 + index);
          return <td key={header} style={row.styles[letter] ? { backgroundColor: row.styles[letter] } : undefined}>{String(row.values[header] ?? "")}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  );
}

function PalletPanel({ preview }) {
  const summary = preview.palletSummary;
  return (
    <div className="pallet-layout">
      <div className="summary-grid">
        <Stat label="Dedicated pallets" value={summary.dedicatedPallets} />
        <Stat label="Misc windows" value={summary.miscWindows} />
        <Stat label="Oversized units" value={summary.oversizedUnits} tone="purple" />
        <Stat label="Total windows" value={summary.totalWindows} />
      </div>
      <div className="table-shell pallet-table"><table><thead><tr><th>Customer name</th><th>Customer PO</th><th>Standard windows</th><th>Oversized units</th><th>Pallet assignment</th></tr></thead><tbody>{summary.deals.map((deal) => <tr key={`${deal.customerPO}-${deal.customerName}`}><td>{deal.customerName}</td><td>{deal.customerPO}</td><td>{deal.standardWindowCount}</td><td>{deal.oversizedUnitCount}</td><td>{deal.assignment || "Special placement only"}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export default function Home() {
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Review");
  const preview = useMemo(() => model ? buildPreviewModel(model) : null, [model]);

  useEffect(() => {
    let active = true;
    loadActiveTruck()
      .then((savedModel) => { if (active && savedModel) setModel(savedModel); })
      .catch(() => { if (active) setError("The previous truck could not be restored from browser storage."); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (restoring || !model) return;
    saveActiveTruck(model).catch(() => setError("Changes are working, but this browser could not save them for refresh recovery."));
  }, [model, restoring]);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setModel(await importRawWorkbook(file));
      setTab("Review");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The workbook could not be imported.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const download = async (builder) => {
    setBusy(true);
    setError("");
    try { saveFile(await builder(model)); }
    catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "Export failed."); }
    finally { setBusy(false); }
  };

  const clearTruck = async () => {
    setBusy(true);
    setError("");
    try {
      await clearActiveTruck();
      setModel(null);
      setTab("Review");
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "The saved truck could not be cleared.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <header className="topbar"><div className="brand"><span>TL</span><div><strong>Truck List Maker</strong><small>Warehouse-ready, rule-driven exports</small></div></div><div className="header-actions">{model && <button className="clear-truck" onClick={clearTruck} disabled={busy}>Clear truck</button>}<label className="replace-file">{model ? "Replace workbook" : "Upload workbook"}<input type="file" accept=".xlsx" onChange={upload} disabled={busy || restoring} /></label></div></header>
      {error && <div className="error-banner"><strong>Couldn’t continue.</strong> {error}</div>}
      {restoring ? <section className="restore-state"><div className="restore-spinner" /><strong>Restoring saved truck…</strong></section> : !model ? <EmptyState onUpload={upload} busy={busy} /> : (
        <div className="workspace">
          <section className="hero-strip">
            <div><p className="eyebrow">Truck date</p><h1>{preview.reportDate}</h1><p>{model.rows.length.toLocaleString()} source rows · {model.loadIds.length} detected load IDs · treated as one truck</p></div>
            <div className="summary-grid compact-grid"><Stat label="Review pending" value={preview.pendingReviewCount} tone={preview.pendingReviewCount ? "warning" : "success"} /><Stat label="Oversized" value={preview.palletSummary.oversizedUnits} tone="purple" /><Stat label="Windows" value={preview.palletSummary.totalWindows} /></div>
          </section>
          {preview.warnings.map((warning) => <div className="warning-banner" key={warning}>{warning} Latest detected date is selected by default.</div>)}
          <nav className="tabs">{TABS.map((name) => <button className={tab === name ? "active" : ""} onClick={() => setTab(name)} key={name}>{name}{name === "Review" && preview.pendingReviewCount > 0 ? <span>{preview.pendingReviewCount}</span> : null}</button>)}</nav>
          <section className="content-panel">
            {tab === "Review" && <ReviewPanel model={model} setModel={setModel} />}
            {tab === "Truck list" && <><div className="legend">{Object.entries(FILLS).map(([name, fill]) => <span key={name}><i style={{ background: fill }} />{name.replace(/([A-Z])/g, " $1")}</span>)}</div><TruckTable preview={preview} /></>}
            {tab === "Pallets" && <PalletPanel preview={preview} />}
          </section>
          <footer className={`export-bar ${preview.canExport ? "expanded" : "collapsed"}`}>
            <div className="export-status">
              <strong>{preview.canExport ? "Exports ready" : "Exports locked"}</strong>
              <span>{preview.canExport ? "All review decisions are recorded." : `${preview.pendingReviewCount.toLocaleString()} review items remain.`}</span>
            </div>
            {preview.canExport && <div className="export-actions"><button className="button secondary" disabled={busy} onClick={() => download(exportInventoryWorkbook)}>Inventory Excel</button><button className="button secondary" disabled={busy} onClick={() => download(exportTruckListPdf)}>Truck-list PDF</button><button className="button" disabled={busy} onClick={() => download(exportPalletPdf)}>Pallet PDF</button></div>}
          </footer>
        </div>
      )}
    </main>
  );
}
