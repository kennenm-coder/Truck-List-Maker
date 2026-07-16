"use client";

import { useEffect, useMemo, useState } from "react";

import { FILLS } from "../src/config/business-rules.js";
import { importRawWorkbook } from "../src/engine/importer.js";
import { buildPreviewModel } from "../src/engine/preview.js";
import { applyCustomerCorrection, applyReviewDecision, approveAllPendingAsBlank } from "../src/engine/truck-model.js";
import { exportInventoryWorkbook } from "../src/export/excel.js";
import { exportPalletPdf, exportTruckListPdf } from "../src/export/pdf.js";
import { clearActiveTruck, loadActiveTruck, saveActiveTruck } from "../src/storage/truck-session.js";

const MODULES = [
  { id: "Review", code: "01", label: "Exception Review" },
  { id: "Truck list", code: "02", label: "Truck Manifest" },
  { id: "Pallets", code: "03", label: "Pallet Plan" },
];

const FILTERS = ["All", "Service", "Oversized", "Backorder", "Small deal"];

function saveFile(result) {
  const blob = new Blob([result.bytes], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Metric({ label, value, alert = false }) {
  return <div className={`metric ${alert ? "metric-alert" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function UploadScreen({ onUpload, busy }) {
  return (
    <section className="intake-screen">
      <div className="intake-header"><span>TRUCK INTAKE</span><strong>01</strong></div>
      <div className="intake-body">
        <label className={`industrial-dropzone ${busy ? "is-busy" : ""}`}>
          <span className="dropzone-code">XLSX</span>
          <strong>{busy ? "PROCESSING WORKBOOK" : "IMPORT TRUCK WORKBOOK"}</strong>
          <span className="dropzone-action">SELECT XLSX</span>
          <input type="file" accept=".xlsx" onChange={onUpload} disabled={busy} />
        </label>
      </div>
    </section>
  );
}

function ReviewPanel({ model, setModel, notify }) {
  const pending = model.reviewItems.filter((item) => item.status === "pending");
  const [selectedId, setSelectedId] = useState(pending[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const selected = pending.find((item) => item.id === selectedId) ?? pending[0] ?? null;
  const selectedRow = selected ? model.rows.find((row) => row.id === selected.rowId) : null;

  useEffect(() => {
    if (!pending.some((item) => item.id === selectedId)) {
      setSelectedId(pending[0]?.id ?? null);
      setDraft("");
    }
  }, [pending, selectedId]);

  const visible = pending.filter((item) => {
    if (!query.trim()) return true;
    const row = model.rows.find((candidate) => candidate.id === item.rowId);
    const haystack = `${item.sourceRow} ${item.sourceColumn} ${row?.transformed["Customer PO"]} ${row?.transformed.Name}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const decide = (action) => {
    if (!selected) return;
    if (action === "correct" && !draft.trim()) return;
    const next = selected.sourceColumn === "SO Reference A" && action === "correct"
      ? applyCustomerCorrection(model, selected.rowId, draft, true)
      : applyReviewDecision(model, selected.id, { action, replacement: draft });
    setModel(next);
    notify(action === "correct" ? "Correction saved to matching deal" : "Blank approval recorded");
  };

  const approveAll = () => {
    if (!window.confirm(`Approve all ${pending.length} remaining review items as blank? This decision will be recorded for this truck.`)) return;
    setModel(approveAllPendingAsBlank(model));
    notify("All remaining items approved as blank");
  };

  if (!pending.length) {
    return <div className="release-state"><div className="release-mark">OK</div><div><span>REVIEW GATE CLEARED</span><h2>Truck package is ready for release.</h2><p>All exceptions have a recorded correction or approval. Open the manifest and pallet plan for a final check.</p></div></div>;
  }

  return (
    <div className="review-workstation">
      <aside className="review-queue">
        <div className="queue-header"><div><span>OPEN EXCEPTIONS</span><strong>{pending.length}</strong></div><button onClick={approveAll}>APPROVE ALL</button></div>
        <div className="queue-search"><span>FIND</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Row, PO, or customer" /></div>
        <div className="queue-list">
          {visible.map((item, index) => {
            const row = model.rows.find((candidate) => candidate.id === item.rowId);
            const code = item.sourceColumn === "SO Reference A" ? "F" : item.sourceColumn === "SO Reference B" ? "G" : item.kind === "measurement" ? "DIM" : "CUST";
            return <button className={`queue-item ${selected?.id === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)} key={item.id}><span className="queue-index">{String(index + 1).padStart(2, "0")}</span><span className="column-code">{code}</span><span className="queue-copy"><strong>{row?.transformed.Name || "CUSTOMER REQUIRED"}</strong><small>ROW {item.sourceRow} · PO {row?.transformed["Customer PO"] || "—"}</small></span><span className="queue-arrow">›</span></button>;
          })}
          {!visible.length && <div className="queue-empty">No exceptions match this search.</div>}
          <div className="queue-scroll-buffer" aria-hidden="true" />
        </div>
      </aside>

      <section className="review-detail">
        {selected && selectedRow && <>
          <div className="detail-header"><div><span>EXCEPTION {selected.sourceRow}-{selected.sourceColumn === "SO Reference A" ? "F" : "G"}</span><h2>{selected.kind === "placeholderCustomer" ? "Customer placeholder requires review" : selected.kind === "measurement" ? "Window measurement requires review" : `Literal null detected in ${selected.sourceColumn}`}</h2></div><div className="severity-tag">BLOCKING</div></div>
          <div className="source-strip"><div><span>SOURCE ROW</span><strong>{selected.sourceRow}</strong></div><div><span>CUSTOMER PO</span><strong>{selectedRow.transformed["Customer PO"] || "—"}</strong></div><div><span>JOB ORDER</span><strong>{selectedRow.transformed["Job Order Number"] || "—"}</strong></div><div><span>SO ORDER</span><strong>{selectedRow.transformed["SO Order Number"] || "—"}</strong></div></div>
          <div className="field-comparison"><div className="field-block original"><label>RAW VALUE · {selected.sourceColumn}</label><code>{selected.originalValue || "EMPTY"}</code></div><div className="field-block"><label>CORRECTED VALUE</label><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Enter verified value" onKeyDown={(event) => { if (event.key === "Enter") decide("correct"); }} /></div></div>
          <div className="deal-context"><span>DEAL CONTEXT</span><dl><div><dt>Current customer</dt><dd>{selectedRow.transformed.Name || "Not available"}</dd></div><div><dt>Line item</dt><dd>{selectedRow.transformed["SO Line Item"] || "Not available"}</dd></div><div><dt>Description</dt><dd>{selectedRow.transformed.Description || "Not available"}</dd></div></dl></div>
          <div className="decision-bar"><div><strong>{selected.sourceColumn === "SO Reference A" ? "Deal-wide correction" : "Row correction"}</strong><span>{selected.sourceColumn === "SO Reference A" ? "Saving a name updates matching deal rows." : "This value applies to the selected source row."}</span></div><button className="action-outline" onClick={() => decide("approveBlank")}>APPROVE BLANK</button><button className="action-primary" disabled={!draft.trim()} onClick={() => decide("correct")}>SAVE CORRECTION</button></div>
        </>}
      </section>
    </div>
  );
}

function rowMatchesFilter(row, filter) {
  if (filter === "Service") return row.classification.isService;
  if (filter === "Oversized") return row.classification.isOversized;
  if (filter === "Backorder") return row.classification.isBackordered;
  if (filter === "Small deal") return row.classification.isSmallDeal;
  return true;
}

function TruckTable({ preview }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const rows = preview.rows.filter((row) => {
    const matchesFilter = rowMatchesFilter(row, filter);
    const haystack = `${row.values.Name} ${row.values["Customer PO"]} ${row.values["Job Order Number"]} ${row.values.Description}`.toLowerCase();
    return matchesFilter && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  });

  return <div className="manifest-view">
    <div className="data-toolbar"><div className="data-search"><span>SEARCH MANIFEST</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, PO, job, description" /></div><div className="filter-bank">{FILTERS.map((name) => <button className={filter === name ? "active" : ""} onClick={() => setFilter(name)} key={name}>{name.toUpperCase()}</button>)}</div><div className="record-count"><strong>{rows.length}</strong><span>ROWS SHOWN</span></div></div>
    <details className="color-key"><summary>CLASSIFICATION COLOR KEY</summary><div>{Object.entries(FILLS).map(([name, fill]) => <span key={name}><i style={{ background: fill }} />{name.replace(/([A-Z])/g, " $1").toUpperCase()}</span>)}</div></details>
    <div className="table-shell manifest-table"><table><thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{preview.headers.map((header, index) => { const letter = String.fromCharCode(65 + index); return <td key={header} style={row.styles[letter] ? { backgroundColor: row.styles[letter] } : undefined} title={String(row.values[header] ?? "")}>{String(row.values[header] ?? "")}</td>; })}</tr>)}</tbody></table></div>
  </div>;
}

function PalletPanel({ preview }) {
  const summary = preview.palletSummary;
  const [query, setQuery] = useState("");
  const deals = summary.deals.filter((deal) => `${deal.customerName} ${deal.customerPO}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="pallet-view">
    <div className="pallet-summary"><Metric label="DEDICATED PALLETS" value={summary.dedicatedPallets} /><Metric label="MISC WINDOWS" value={summary.miscWindows} /><Metric label="SPECIAL PLACEMENT" value={summary.oversizedUnits} alert /><Metric label="TOTAL WINDOWS" value={summary.totalWindows} /></div>
    <div className="placement-alert"><div className="alert-code">OS</div><div><strong>{summary.oversizedUnits} OVERSIZED UNITS REQUIRE SPECIAL WAREHOUSE PLACEMENT</strong><span>These units are excluded from dedicated and miscellaneous pallet assignments.</span></div></div>
    <div className="data-toolbar pallet-toolbar"><div className="data-search"><span>FIND CUSTOMER / DEAL</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer name or PO" /></div><div className="record-count"><strong>{deals.length}</strong><span>DEALS SHOWN</span></div></div>
    <div className="table-shell pallet-table"><table><thead><tr><th>Customer name</th><th>Customer PO</th><th>Standard windows</th><th>Oversized units</th><th>Pallet assignment</th></tr></thead><tbody>{deals.map((deal) => <tr key={`${deal.customerPO}-${deal.customerName}`}><td>{deal.customerName}</td><td>{deal.customerPO}</td><td>{deal.standardWindowCount}</td><td className={deal.oversizedUnitCount ? "oversize-count" : ""}>{deal.oversizedUnitCount}</td><td><span className={`assignment ${deal.assignment ? "" : "special"}`}>{deal.assignment || "SPECIAL PLACEMENT"}</span></td></tr>)}</tbody></table></div>
  </div>;
}

export default function Home() {
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [savedState, setSavedState] = useState("LOCAL SESSION");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState("Review");
  const preview = useMemo(() => model ? buildPreviewModel(model) : null, [model]);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  useEffect(() => {
    let active = true;
    loadActiveTruck().then((savedModel) => { if (active && savedModel) setModel(savedModel); }).catch(() => { if (active) setError("The previous truck could not be restored from browser storage."); }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (restoring || !model) return;
    setSavedState("SAVING…");
    const timeout = window.setTimeout(() => saveActiveTruck(model).then(() => setSavedState("SAVED LOCALLY")).catch(() => { setSavedState("SAVE FAILED"); setError("Changes are working, but this browser could not save them for refresh recovery."); }), 180);
    return () => window.clearTimeout(timeout);
  }, [model, restoring]);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try { setModel(await importRawWorkbook(file)); setTab("Review"); notify(`${file.name} imported`); }
    catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "The workbook could not be imported."); }
    finally { setBusy(false); event.target.value = ""; }
  };

  const download = async (builder) => {
    setBusy(true); setError("");
    try { const result = await builder(model); saveFile(result); notify(`${result.fileName} downloaded`); }
    catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "Export failed."); }
    finally { setBusy(false); }
  };

  const clearTruck = async () => {
    if (!window.confirm("Clear the active truck and all recorded review decisions from this browser?")) return;
    setBusy(true); setError("");
    try { await clearActiveTruck(); setModel(null); setTab("Review"); setSavedState("LOCAL SESSION"); }
    catch (clearError) { setError(clearError instanceof Error ? clearError.message : "The saved truck could not be cleared."); }
    finally { setBusy(false); }
  };

  return <main className="app-shell">
    <header className="utility-header"><div className="industrial-brand"><span className="brand-block">TL</span><div><strong>TRUCK LIST MAKER</strong><small>WAREHOUSE OPERATIONS</small></div></div><div className="system-status"><span className="status-light" />{savedState}</div><div className="header-actions">{model && <button className="header-button destructive" onClick={clearTruck} disabled={busy}>CLEAR TRUCK</button>}<label className="header-button primary">{model ? "IMPORT NEW" : "IMPORT XLSX"}<input type="file" accept=".xlsx" onChange={upload} disabled={busy || restoring} /></label></div></header>
    {error && <div className="system-message error"><strong>SYSTEM NOTICE</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
    {toast && <div className="toast"><span>✓</span>{toast}</div>}
    {restoring ? <section className="restore-state"><div className="restore-spinner" /><strong>RESTORING LOCAL TRUCK SESSION</strong></section> : !model ? <UploadScreen onUpload={upload} busy={busy} /> : <>
      <section className="truck-command-bar"><div className="truck-id"><span>ACTIVE TRUCK</span><strong>{preview.reportDate}</strong><small>{model.rows.length.toLocaleString()} SOURCE ROWS · {model.loadIds.length} LOAD IDS · ONE TRUCK</small></div><div className="command-metrics"><Metric label="REVIEW OPEN" value={preview.pendingReviewCount} alert={preview.pendingReviewCount > 0} /><Metric label="PALLETS" value={preview.palletSummary.dedicatedPallets} /><Metric label="MISC WINDOWS" value={preview.palletSummary.miscWindows} /><Metric label="OVERSIZED" value={preview.palletSummary.oversizedUnits} alert /><Metric label="TOTAL WINDOWS" value={preview.palletSummary.totalWindows} /></div></section>
      {preview.warnings.map((warning) => <div className="system-message warning" key={warning}><strong>DATE CONFLICT</strong><span>{warning} Latest detected date selected.</span></div>)}
      <nav className="module-nav">{MODULES.map((module) => <button className={tab === module.id ? "active" : ""} onClick={() => setTab(module.id)} key={module.id}><span>{module.code}</span><strong>{module.label}</strong>{module.id === "Review" && preview.pendingReviewCount > 0 && <b>{preview.pendingReviewCount}</b>}</button>)}</nav>
      <section className="module-frame">{tab === "Review" && <ReviewPanel model={model} setModel={setModel} notify={notify} />}{tab === "Truck list" && <TruckTable preview={preview} />}{tab === "Pallets" && <PalletPanel preview={preview} />}</section>
      <footer className={`release-drawer ${preview.canExport ? "open" : "locked"}`}><div className="release-status"><span>{preview.canExport ? "RELEASE GATE: CLEAR" : "RELEASE GATE: LOCKED"}</span><strong>{preview.canExport ? "EXPORT PACKAGE READY" : `${preview.pendingReviewCount} REVIEWS OPEN`}</strong></div>{preview.canExport && <div className="release-actions"><button disabled={busy} onClick={() => download(exportInventoryWorkbook)}><span>XLSX</span>INVENTORY UPLOAD</button><button disabled={busy} onClick={() => download(exportTruckListPdf)}><span>PDF</span>TRUCK MANIFEST</button><button className="release-primary" disabled={busy} onClick={() => download(exportPalletPdf)}><span>PDF</span>PALLET PLAN</button></div>}</footer>
    </>}
  </main>;
}
