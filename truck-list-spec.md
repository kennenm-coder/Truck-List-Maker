You are building this application inside the current repository.

The following Excel files are reference fixtures and must be inspected before implementation:

1. PackingListRAW DATA.xlsx
2. (Template) Truck List 00-00-0000 (With Pallet Maker).xlsx
3. Completed Truck List 07-16-2026.xlsx

The written specification below is the source of truth when it conflicts with formulas or formatting in the existing Excel template.

Important clarification:

The completed workbook was generated using older rules. In particular, the web app must classify a window as oversized only when its width is greater than 54 inches. Do not assume the completed workbook’s existing oversized count is the correct acceptance-test total. Recalculate the expected result from the raw data using the new rules.

Work in this order:

1. Inspect all three workbooks, including every worksheet, header, formula, merged cell, conditional-formatting rule, print area, and sample output.
2. Write a short implementation report documenting:

   * Workbook structure
   * Raw-to-final column mapping
   * Data types
   * Existing formulas
   * Existing conditional formatting
   * Differences between the workbook and written specification
   * Any remaining blocker that cannot be resolved from the supplied files
3. Create automated tests for the transformation logic before building the interface.
4. Build the raw-file importer and normalized internal data model.
5. Build the null-review and correction workflow.
6. Build classification and pallet calculations.
7. Build the Excel export.
8. Build the truck-list PDF and pallet PDF.
9. Build the web interface around the tested processing engine.
10. Run all tests and process the supplied raw file through the completed application.

Do not merely recreate the spreadsheet visually. Create a deterministic processing engine that produces the spreadsheet and PDF outputs from normalized data.

Required engineering rules:

* Treat identifiers and barcodes as strings.
* Never convert barcodes into JavaScript numbers.
* Preserve leading zeros.
* Locate source columns by header names rather than fixed indexes.
* Keep the original raw row and transformed row available for audit.
* Every cell containing the literal text `null` must be corrected or explicitly approved; genuinely empty cells are allowed.
* One uploaded raw file represents one truck.
* The written business rules override legacy spreadsheet formulas.
* Keep business rules in configuration where practical.
* Separate parsing, validation, calculations, rendering, and exporting into testable modules.
* Do not bury business logic inside React components.
* Do not mark the task complete until the supplied raw workbook can be imported and all three required outputs can be downloaded.

Create acceptance tests covering:

* Exact final header names and order
* Preservation of leading zeros
* Preservation of full barcode values
* Customer-name corrections applied across a deal
* Every literal `null` value requiring correction or approval, while genuinely empty cells remain allowed
* Service yellow overriding small-deal orange in column B
* Small-deal orange remaining in column C
* PN and OK producing dark-green column-F highlighting
* PTD producing blue column-G highlighting
* ED producing light-green column-G highlighting
* BO Qty equal to 1 producing red column-J highlighting
* Oversized windows being greater than 54 inches wide
* Exactly 54 inches not being oversized
* Oversized windows excluded from normal and miscellaneous pallet counts
* Fewer than five standard windows being counted as Misc Windows
* Five or more standard windows using ceiling(window count / 7)
* Excel and PDF exports matching the web preview’s classifications

Before changing code, inspect the repository and preserve the existing framework, database, authentication, deployment, and styling conventions unless they prevent the application from meeting this specification.

After inspection, implement the application rather than returning only recommendations. Stop only for a genuine business-rule conflict that cannot be resolved from the files or written specification.
# Truck List Web App — Final Clarified Rules

## 1. One Upload Equals One Truck

Each raw Excel file represents one truck.

The app should:

* Treat the entire uploaded workbook as one truck
* Not split the data by Load ID
* Not require the user to select or combine loads
* Use the truck date found in the uploaded data for report titles
* Warn the user only if conflicting truck dates are detected

---

## 2. Literal Null Values Are Review Flags

Every cell containing the literal text `null` (case-insensitive and ignoring surrounding spaces) is a red flag. Genuinely empty cells are allowed and do not require review. Customer placeholders are still flagged separately.

A flagged value does not always need to be replaced, but it must be reviewed before export.

For every null flag, the user must choose one of two actions:

1. Enter or correct the missing information
2. Approve the value as intentionally blank

The app must not automatically replace every null value with customer information.

The review screen should show:

* Source row
* Customer PO
* Customer name
* Column containing the null
* Original value
* Editable replacement field
* `Approve as Blank` option

The export should remain blocked until every null flag has either been corrected or approved.

Approved blank values should remain blank in the final export.

---

## 3. Missing Customer Information

When customer information is null or contains a placeholder such as `Renewal by Andersen`, the user will look up the correct information in the company’s internal software and manually enter it.

The web app does not need to connect to that internal software for the MVP.

The app should allow the correction to be applied across all rows belonging to the same deal.

Recommended matching priority:

1. Customer PO
2. Job Order Number
3. SO Order Number

The user should not have to enter the same corrected customer name on every line of the deal.

---

## 4. Small-Deal Highlighting

The current counting logic is valid.

Each appearance of the matching customer/deal number represents one unit.

Group rows using:

* Customer name in column C
* Customer PO in column B

Count how many times that combination appears in the truck list.

```text
dealUnitCount =
count of rows having the same Customer PO and Customer Name
```

When the count is three or fewer:

```text
isSmallDeal = dealUnitCount <= 3
```

Highlight columns B and C orange for those rows unless the service rule overrides column B.

Examples:

```text
1 matching row = orange
2 matching rows = orange
3 matching rows = orange
4 matching rows = no orange
```

Do not introduce additional filtering based on Component Ordered for this rule.

---

## 5. Service Highlight Wins

A service job is identified when the Customer PO in column B ends with `S`.

The comparison should:

* Ignore capitalization
* Ignore trailing spaces
* Require `S` to be the final meaningful character

```text
isService =
trim(uppercase(customerPO)).endsWith("S")
```

Highlight column B yellow.

When a row is both a service job and a small deal:

* Column B is yellow
* Column C remains orange

Service yellow takes precedence over small-deal orange in column B.

---

## 6. PN and OK Interior Highlighting

Column F should be highlighted dark green when its value contains either:

* `PN`
* `OK`

The check should be case-insensitive.

```text
hasSpecialInterior =
columnF contains "PN"
OR
columnF contains "OK"
```

Highlight only column F dark green.

---

## 7. Backorder Logic

A value of `1` in column J means the item is backordered.

```text
isBackordered = BO Qty == 1
```

Highlight column J red.

Do not interpret any number greater than zero as backordered unless the source format changes later.

The parser should support the following equivalent values:

* Numeric `1`
* Text `"1"`
* Text with spaces such as `" 1 "`

Blank, null, or zero means not backordered unless manually corrected.

---

## 8. Oversized Window Logic

A unit is oversized when:

1. It is a window
2. Its extracted width is greater than 54 inches

```text
isOversized =
isWindow
AND extractedWidth > 54
```

Exactly 54 inches is not oversized.

```text
54.00 inches = standard
54.01 inches = oversized
```

The measurement being evaluated is the width, meaning the first measurement before the `X`.

Examples:

```text
53.5 X 60 = standard
54 X 70 = standard
54.25 X 40 = oversized
60 X 36 = oversized
```

Append the following exact token to the description:

```text
-OVRSIZE-
```

Do not append the token more than once.

The app should continue recognizing either spelling in previously processed files:

```text
-OVRSIZE-
-OVERSIZE-
```

### Determining Whether It Is a Window

Use the same product-family or line-item logic currently used by the workbook.

The recognized window tokens and exclusions should be placed in editable application configuration instead of hard-coded throughout the app.

The app must not mark doors, screens, hardware, trim, or miscellaneous parts as oversized merely because a large measurement appears in their description.

---

## 9. Oversized Units Are Not Palletized

Oversized windows do not receive a pallet calculation.

They should only be counted and reported as oversized units.

```text
oversizeTotal =
count of oversized window units
```

The pallet report should display how many oversized units require special warehouse placement.

Do not calculate:

* Oversized pallet quantity
* Oversized pallet capacity
* Oversized pallet assignment

Suggested label:

```text
Oversized Units Requiring Special Placement
```

---

## 10. Miscellaneous Pallet Logic

Do not calculate how many miscellaneous pallets are required.

Only calculate how many standard windows need to be placed on miscellaneous pallets.

Current standard-window logic:

```text
If a deal has fewer than 5 standard windows:
    Those windows are assigned to Misc

If a deal has 5 or more standard windows:
    Dedicated pallets = ceiling(standardWindowCount / 7)
```

Examples:

```text
1 standard window  = 1 Misc Window
2 standard windows = 2 Misc Windows
3 standard windows = 3 Misc Windows
4 standard windows = 4 Misc Windows
5–7 windows        = 1 dedicated pallet
8–14 windows       = 2 dedicated pallets
15–21 windows      = 3 dedicated pallets
```

Oversized windows are excluded from the standard-window and miscellaneous-window counts.

The final pallet summary should contain:

```text
Dedicated Pallets
Misc Windows
Oversized Units
Total Windows
```

Do not label `Misc Windows` as `Misc Pallets`.

---

# Final Color Precedence

Apply formatting in this order.

## Column B — Customer PO

1. Yellow when service
2. Orange when small deal and not service

## Column C — Customer Name

1. Orange when small deal

## Column F — SO Line Item

1. Dark green when containing `PN` or `OK`

## Column G — Description

1. Purple when oversized
2. Blue when patio door
3. Light green when entry door

Oversized purple wins when multiple description rules match.

## Column J — BO Qty

1. Red when BO Qty equals `1`

---

# Final Processing Flow

## Step 1 — Upload

The user uploads the raw truck Excel file.

One upload represents one truck.

## Step 2 — Validate

The app verifies the expected column headers and checks for unsafe identifier conversion.

## Step 3 — Transform

The app maps raw columns into the corrected inventory-system headers.

## Step 4 — Detect Flags

The app identifies:

* Null or blank fields
* `Renewal by Andersen` placeholders
* Missing customer information
* Measurements that failed to parse
* Oversized windows
* Service jobs
* Small deals
* Patio doors
* Entry doors
* PN or OK interiors
* Backorders

## Step 5 — Manual Review

The user corrects or approves every flagged null value.

Customer corrections may be applied to the entire deal.

Missing measurements are entered in the measurement-review column.

## Step 6 — Recalculate

After every correction, the app recalculates:

* Oversized status
* Highlight colors
* Deal counts
* Dedicated pallets
* Misc window count
* Oversized unit count
* Total window count

## Step 7 — Preview

The user reviews:

* Inventory upload table
* Color-coded truck list
* Pallet requirements

## Step 8 — Export

Generate:

1. Inventory Upload Excel
2. Color-Coded Truck List PDF
3. Pallet Requirements PDF
4. Optional ZIP containing all three files

---

# Required Pallet Report Fields

For each customer/deal:

```text
Customer Name
Customer PO
Standard Window Count
Oversized Unit Count
Pallet Assignment
```

Possible pallet-assignment values:

```text
Misc
1 Pallet
2 Pallets
3 Pallets
```

Example:

| Customer    |      PO | Standard Windows | Oversized | Assignment |
| ----------- | ------: | ---------------: | --------: | ---------- |
| Smith,John  |  123456 |                4 |         1 | Misc       |
| Jones,Mary  |  123457 |                7 |         0 | 1 Pallet   |
| Miller,Adam | 123458S |               14 |         2 | 2 Pallets  |

Summary:

```text
Dedicated Pallets: 3
Misc Windows: 4
Oversized Units: 3
Total Windows: 28
```

---

# MVP Boundary

The first version does not need:

* Internal-software integration
* Automatic customer lookup
* Multiple-truck handling
* Oversized pallet calculations
* Miscellaneous pallet-capacity calculations
* User accounts
* Long-term data storage

The MVP must reliably:

* Import one raw truck file
* Map the correct columns
* Surface every null for approval
* Accept manual customer and measurement corrections
* Apply the final highlight rules
* Calculate dedicated pallets, misc windows, and oversized counts
* Export the inventory Excel and both PDFs
