# Truck List workbook implementation report

## Repository and fixture inventory

The repository initially contained no application scaffold or prior commits. It contained only `truck-list-spec.md` and three untracked workbook fixtures under `reference-files/`. The raw fixture is named `PackingListRAW DATA (1).xlsx`, which is treated as the specified `PackingListRAW DATA.xlsx` fixture.

All worksheets were imported and visually rendered in bounded row segments. Workbook XML was also inspected for formulas, cached values, merged cells, conditional formatting, tables, defined names, page setup, and print areas.

## Workbook structure

| Workbook | Worksheet | Used range | Purpose |
| --- | --- | ---: | --- |
| Raw packing list | `Table1` | `A1:Y592` | 25 source columns and 591 data rows. No formulas, merges, conditional formatting, tables, defined names, or print area. |
| Template | `RAW Truck List Data` | `A1:Z1001` | Paste area for the 25-column source. Required input columns are white; unused columns are red. Includes a placeholder-customer conditional format on column F. |
| Template | `Helper Trucklist Page` | `A1:S2049` | Maps the source into 13 final columns, derives customer names and width, and appends the legacy oversize token. |
| Template | `Copy This Data` | `A1:A1` | Dynamic-array projection of non-empty helper rows into the 13 final columns. |
| Template | `Paste Here ctrl+shift+v List` | `A1:M348` | Values-only final truck-list staging area with conditional formatting. |
| Template | `Pallets Helper` | `A1:V813` | Filters `Component Ordered = "full"`, groups window rows, and calculates legacy pallet totals. |
| Template | `Pallets Needed` | `A1:F6` | Printable pallet summary. `A1:F1` is the workbook's only merged range. |
| Completed | same six worksheets | ranges through `A1:Z1001`, `A1:S2049`, `A1:M592`, `A1:V813`, and `A1:F56` | Populated sample output based on the raw fixture and legacy rules. |

All sheets are visible. No worksheet has a defined print area or print-title range. The final truck-list sheet is configured landscape; helper and pallet output sheets are portrait/default. The completed pallet sheet visually reports 47 pallets, 46 misc windows, 35 oversized units, and 337 total windows under its legacy grouping/calculation behavior.

## Raw-to-final mapping

The final output header names and order are exact and fixed; source lookup will use normalized header text, never column positions.

| Final column | Final header | Source header | Internal type / transformation |
| ---: | --- | --- | --- |
| A | `Job Order Number` | `SO Order Number` | identifier string |
| B | `Customer PO` | `Customer PO` | identifier string |
| C | `Name` | `SO Reference A` | customer string; cleaned/corrected during review |
| D | `SO Order Number` | `SO Reference B` | identifier string; leading zeroes preserved |
| E | `Truck Ship Date` | `Actual Ship Date` | parsed date with original source text retained |
| F | `SO Line Item` | `SO Line Item` | identifier/product string |
| G | `Description` | `SO Line Item Description` | description string; append `-OVRSIZE-` once when classified oversized |
| H | `Order Qty` | `Order Qty` | integer quantity |
| I | `Delivered Qty` | `Delivered Qty` | integer quantity |
| J | `BO Qty` | `BO Qty` | integer quantity; only exact numeric-equivalent 1 is backordered |
| K | `Floor ID` | `Floor ID` | string |
| L | `Component Ordered` | `Component Ordered` | string/category |
| M | `Barcode` | `Barcodes` | opaque string; never converted to a JavaScript number |

The raw workbook stores `Load Id`, `Customer PO`, references, line items, descriptions, and barcodes as strings. Several identifier-like source columns (`SO Order Number`, delivery/customer codes, positions, and quantities) are stored as integers, so the importer must stringify identifier fields immediately. Barcodes are strings up to 28 characters in this fixture. `Actual Ship Date` is stored as text. Quantities are integers.

The final null-review rule is column-specific: literal `null` in raw column F (`SO Reference A`) is always flagged; literal `null` in raw column G (`SO Reference B`) is flagged only when F on that row is empty or `null`. Literal `null` values in other columns and genuinely empty cells are allowed. The raw file also contains 31 customer-placeholder rows containing `Renewal by Andersen`.

## Existing formulas

The template and completed workbook use the same formula families:

- `Helper Trucklist Page!A:M` maps source columns D, E, G, I, L, O, P, Q, R, T, U, and X into the final schema. Customer names are derived from source column F through helper columns R/S and character filtering.
- `Helper Trucklist Page!O` extracts the final numeric token before the first `X` as width.
- `Helper Trucklist Page!G` excludes descriptions containing `NLGD` or `FWG`, recognizes `GL`, `DGB`, `DGI`, `GT`, `CS`, `PWU`, `DBI`, or `SWU`, and appends `-OVRSIZE-` when the extracted width is greater than **52**.
- `Copy This Data!A1` filters non-empty helper rows into columns A:M.
- `Pallets Helper!A1` filters final rows to `Component Ordered = "full"`; this is the legacy definition of a palletized window row.
- `Pallets Helper!O/Q` recognizes either `-OVRSIZE-` or `-OVERSIZE-`, then groups rows by customer name only and separates standard/oversized counts.
- `Pallets Helper!T` labels fewer than five standard windows `Misc Pallet`; otherwise it uses `ROUNDUP(standard count / 7, 0)`.
- `Pallets Helper!V2:V5` totals dedicated pallets, miscellaneous window units, oversized units, and all `Component Ordered = "full"` rows.
- `Pallets Needed!A1/A2` builds the dated printable title and spills the helper summary.

The dynamic-array formulas use newer Excel functions (`FILTER`, `LET`, `MAP`, `BYROW`, `HSTACK`, and `VSTACK`). Their cached values were inspected because non-Excel renderers do not evaluate every function consistently.

## Existing conditional formatting

- Raw data column F: contains `Renewal by Andersen Store 975` -> pale red.
- Helper column O: blank extracted width -> pale fill; helper column P has an amber measurement-related rule.
- Final columns B:C: orange when the first nine PO characters appear fewer than four times in B2:B2000.
- Final column F: dark green when it contains `OK` or `PN`.
- Final column G: light green when column F begins `ED`; blue when F contains `PTD`; purple when G contains `OVRSIZE`.
- Final column J: red when its text contains `1`.

The template does not contain the required service-yellow rule. None of the conditional-format rules set `stopIfTrue`, so explicit precedence is not reliably enforced by the workbook.

## Differences from the written specification

The implementation follows the written rules in every conflict:

- Oversized threshold changes from `>52` to `>54`; exactly 54 remains standard.
- A window row follows the existing `Component Ordered = "full"` pallet definition, while oversize eligibility additionally uses the editable legacy inclusion/exclusion tokens. Doors, screens, hardware, trim, and miscellaneous components are therefore not oversized solely due to a measurement.
- Deal grouping changes from customer name only (pallets) or first nine PO characters only (orange formatting) to exact normalized `Customer PO + Name`.
- Service PO yellow is added and overrides orange in column B; column C remains orange for a small service deal.
- Backorder changes from “text contains 1” to numeric-equivalent equality with 1.
- Oversized purple explicitly wins over patio-door blue and entry-door light green in column G.
- `Misc Pallet` becomes `Misc` per deal, and the summary label is `Misc Windows`; no miscellaneous-pallet capacity is calculated.
- Oversized rows are excluded from standard and miscellaneous counts and never receive a pallet assignment.
- Report titles use the uploaded truck date, not `TODAY()`.
- Literal `null` in raw column F always becomes a blocking review item. Literal `null` in raw column G is blocking only when F on the same row is missing. Empty cells and nulls in other columns are allowed. Placeholder customer names are also surfaced for correction/review.
- Raw and transformed rows remain paired in the internal audit model.

## Fixture-specific findings and deterministic choices

The raw fixture contains two ship dates (`7/6/2026` and `7/13/2026`) and two load IDs. Per the specification it is still one truck and is never split by load. The UI warns about the conflicting dates. For deterministic unattended fixture processing, the engine selects the latest parsed source date (`7/13/2026`) as the default report date while retaining the warning and allowing the user to choose another detected date.

Recalculation confirms 337 `Component Ordered = "full"` window rows. Applying the legacy product-token eligibility plus the new width threshold produces 35 oversized units in this particular fixture; this equality with the old workbook's displayed count is coincidental, not copied from it. The expected application totals are calculated from normalized rows and deal keys at runtime, not accepted from workbook caches.

There is no unresolved implementation blocker. Correct customer names for placeholder rows are not available from the fixtures; the MVP therefore correctly requires user correction or explicit review rather than inventing names. The automated end-to-end fixture run uses explicit approval records for intentionally unresolved literal-null values/placeholders so that its exports remain auditable.
