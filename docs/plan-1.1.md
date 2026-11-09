# Qasa ERP 1.1: technical plan

Approved by the owner. Release 1.1 adds units with conversions, batches and expiry dates, a pharmacy pack (Pro), the
API that Qasa Store needs, dollar balances for customers and suppliers, and POS payment methods. This plan is meant to
be built in one pass, in the order given in section 9.

## 0. Ground rules

- **Branches.** In the app repo, `feature/1.1` is cut from `fix/rtl-display`. In `pro/`, `feature/1.1` is cut from
  `main`. Nothing is pushed, merged or tagged. Commits are by meroxis
  (`333022010+meroxis@users.noreply.github.com`), with plain messages and no attribution lines.
- **Layering.** Pure rules and their tests go in `packages/core` first. Then the server (`packages/server`, with the
  tables in `db.ts` and `schema-mysql.ts`), then Pro (`pro/src`), then the screens (`apps/web`).
- **Schema.** Every 1.1 schema change goes in one new migration, **V10** (1.0.3 shipped at version 9). V10 has SQLite
  SQL and a MariaDB/MySQL step (section 1). Copy-before-migrate (`copyBeforeUpdate`) runs for a version-9 file without
  any extra work, because `version < MIGRATIONS.length`. A 1.0.x app that opens a version-10 file refuses it with
  `database_newer` (`refuseNewer`). That is the expected behaviour: the Microsoft Store submission has to ship with
  the installer.
- **Security.** Every body, query and parameter goes through zod (`parse`). SQL is parameterized only; `LIKE` escapes
  with `!`. Every change route has a line in `RULES` (app) or `rules` (Pro extension). Untrusted text (names, batch
  numbers, references) is length-capped and stripped of control characters. The ext API gets a new, separate scope for
  money (`payments:write`). Nothing new is logged with secrets or keys.
- **Texts.** Every new key exists in ar, en and ku (Sorani); `release-texts.test` and the i18n tests enforce this.
  Sample people are only Mer, Las and Raz, each a separate person. Nothing in code, texts or commits mentions any AI
  or tool.
- **Plans.** Units, batches/expiry, item categories, USD balances and POS payment methods are core features in
  **every plan**, Free included, the same as POS and labels. The pharmacy pack is **Pro**, gated like the other
  industry packs. The ext API stays behind `websiteApi` (Pro).

## 1. Migration V10

### 1.1 SQLite (`db.ts`, `const V10`)

```sql
-- 10 — 1.1: units with conversions, item categories, batches and expiry dates, payments kept with an invoice
-- (POS split payments and online payments), the pharmacy pack

CREATE TABLE item_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ku TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE items ADD COLUMN category_id TEXT REFERENCES item_categories(id);
-- the unit picked by default on sale and on purchase lines (NULL = the base unit, items.unit)
ALTER TABLE items ADD COLUMN sale_unit TEXT;
ALTER TABLE items ADD COLUMN purchase_unit TEXT;
-- 0/1: stock kept per batch number; expiry asked on the way in
ALTER TABLE items ADD COLUMN track_batches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN track_expiry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN updated_at TEXT;
CREATE INDEX items_category ON items(category_id);

-- the other units an item is bought or sold in; the base unit (items.unit) is never listed here
CREATE TABLE item_units (
  item_id TEXT NOT NULL REFERENCES items(id),
  unit TEXT NOT NULL,
  -- base units in one of this unit, in thousandths (box = 100 tablets → 100000; gram of a kg item → 1)
  factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
  barcode TEXT,
  -- price of one of this unit, in the item's sale currency; NULL = base price × factor
  sale_price INTEGER CHECK (sale_price IS NULL OR sale_price >= 0),
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, unit)
);
CREATE UNIQUE INDEX item_units_barcode ON item_units(barcode);

-- what a line was entered in. NULL unit = the base unit (every line made before 1.1). qty_milli stays the BASE
-- quantity everywhere, so stock, cost, returns and reports are unchanged
ALTER TABLE invoice_lines ADD COLUMN unit TEXT;
ALTER TABLE invoice_lines ADD COLUMN unit_factor_milli INTEGER;
ALTER TABLE invoice_lines ADD COLUMN unit_qty_milli INTEGER;
-- batches: what came in (purchase) or the batch picked by hand (sale); NULL = automatic (FEFO)
ALTER TABLE invoice_lines ADD COLUMN batch_no TEXT;
ALTER TABLE invoice_lines ADD COLUMN expiry TEXT;
ALTER TABLE invoice_lines ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
ALTER TABLE stock_doc_lines ADD COLUMN unit TEXT;
ALTER TABLE stock_doc_lines ADD COLUMN unit_factor_milli INTEGER;
ALTER TABLE stock_doc_lines ADD COLUMN unit_qty_milli INTEGER;
ALTER TABLE stock_doc_lines ADD COLUMN batch_no TEXT;
ALTER TABLE stock_doc_lines ADD COLUMN expiry TEXT;
ALTER TABLE stock_doc_lines ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
ALTER TABLE stock_adjustment_lines ADD COLUMN unit TEXT;
ALTER TABLE stock_adjustment_lines ADD COLUMN unit_factor_milli INTEGER;
ALTER TABLE stock_adjustment_lines ADD COLUMN unit_qty_milli INTEGER;
ALTER TABLE stock_adjustment_lines ADD COLUMN batch_no TEXT;
ALTER TABLE stock_adjustment_lines ADD COLUMN expiry TEXT;
ALTER TABLE stock_adjustment_lines ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
ALTER TABLE purchase_order_lines ADD COLUMN unit TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN unit_factor_milli INTEGER;
ALTER TABLE purchase_order_lines ADD COLUMN unit_qty_milli INTEGER;

CREATE TABLE item_batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  -- '' = stock that was there before batches were tracked, or a surplus with no number
  number TEXT NOT NULL,
  expiry TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (item_id, number)
);
CREATE INDEX item_batches_expiry ON item_batches(expiry);

-- every batch quantity change, beside stock_moves (which keeps the value); never edited or deleted
CREATE TABLE stock_batch_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES item_batches(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  date TEXT NOT NULL,
  qty_milli INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  line_no INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX stock_batch_moves_batch ON stock_batch_moves(batch_id, warehouse_id);
CREATE INDEX stock_batch_moves_item ON stock_batch_moves(item_id, warehouse_id);
CREATE INDEX stock_batch_moves_source ON stock_batch_moves(source_type, source_id);
CREATE TRIGGER stock_batch_moves_no_update BEFORE UPDATE ON stock_batch_moves BEGIN SELECT RAISE(ABORT, 'stock_moves_are_permanent'); END;
CREATE TRIGGER stock_batch_moves_no_delete BEFORE DELETE ON stock_batch_moves BEGIN SELECT RAISE(ABORT, 'stock_moves_are_permanent'); END;

-- money taken for an invoice outside its own cash/credit: POS split payments (in the sale's own entry) and online
-- payments recorded through the website API (a receipt voucher of their own)
CREATE TABLE invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('pos', 'online')),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'fib', 'zaincash', 'qi', 'account', 'other')),
  account_code TEXT NOT NULL REFERENCES accounts(code),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('IQD', 'USD')),
  entry_id TEXT REFERENCES entries(id),
  source TEXT,
  reference TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, reference)
);
CREATE INDEX invoice_payments_invoice ON invoice_payments(invoice_id);

-- the content hash of an item's picture, so a shop knows when it changed (filled in for old pictures at start-up)
ALTER TABLE item_images ADD COLUMN sha256 TEXT;

-- pharmacy (Pro)
CREATE TABLE pharma_details (
  item_id TEXT PRIMARY KEY REFERENCES items(id),
  generic_name TEXT NOT NULL DEFAULT '',
  -- generic_name through normalizeForSearch: alternatives and search
  generic_key TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL DEFAULT 'other' CHECK (form IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops', 'cream', 'ointment', 'inhaler', 'suppository', 'sachet', 'spray', 'other')),
  strength TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  rx_only INTEGER NOT NULL DEFAULT 0,
  controlled INTEGER NOT NULL DEFAULT 0,
  shelf TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX pharma_details_generic ON pharma_details(generic_key);
CREATE TABLE pharma_controlled_log (
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  line_no INTEGER NOT NULL,
  patient TEXT NOT NULL,
  prescriber TEXT NOT NULL DEFAULT '',
  prescription_no TEXT NOT NULL DEFAULT '',
  notes TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (invoice_id, line_no)
);
```

The `ALTER TABLE invoice_lines ... REFERENCES item_batches(id)` line has to come after `CREATE TABLE item_batches`, so
in V10 the batches table is created before the line ALTERs (the order above is for reading). SQLite allows
`ADD COLUMN` with a `REFERENCES` clause only when the default is NULL, which is the case for every reference here.
No migration in V10 rebuilds a table, so `rebuild` is not set.

**Old rows are never rewritten.** The `posted_invoice_lines_no_update` and `posted_document_is_permanent` triggers
would refuse it. NULL in the new columns means "base unit, no batch", and every reader treats it that way.

**Start-up fill** (`initDatabase` → `ensureDefaults`, safe to run every time): `item_images.sha256` is computed in JS
for rows where it is NULL, 50 rows per run in one transaction, so a large picture table never blocks start-up for
long. The new settings defaults go in here as well (section 2.2).

### 1.2 MariaDB/MySQL

- **`schema-mysql.ts`**
  - New tables with `since: 10`: `item_categories`, `item_units`, `item_batches`, `stock_batch_moves`,
    `invoice_payments`, `pharma_details`, `pharma_controlled_log`.
  - `item_categories` goes in `MYSQL_TABLES` **before `items`**. `items` now has a foreign key to it, and a fresh
    server database creates the tables in list order. `COMPANY_TABLES` derives from this order.
  - The new columns are added **at the end** of the base `CREATE TABLE` of `items`, `invoice_lines`,
    `stock_doc_lines`, `stock_adjustment_lines`, `purchase_order_lines` and `item_images`, in the same order as the
    SQLite ALTERs. `schema.test` checks for "same columns in the same order", and both an `ALTER ... ADD COLUMN` and
    a fresh create put them last.
  - Foreign keys are table clauses: `FOREIGN KEY (category_id) REFERENCES item_categories(id)` and so on.
  - `UNIQUE KEY item_units_barcode (barcode)`. MySQL allows many NULLs, so the code stores an empty barcode as NULL,
    the same as `items.barcode`.
  - `UNIQUE KEY invoice_payments_ref (source, reference)`.
  - Triggers `stock_batch_moves_no_update` and `stock_batch_moves_no_delete`, `since: 10`, through the existing
    `trigger()` helper.
- **`db.ts` `Migration.mysql`**: the type gets a third form, `{ tables: true; steps: (c) => readonly string[] }`.
  `migrateMysql` first creates the missing `since === next` tables and triggers (the existing `'tables'` code, moved
  into `createSinceObjects(db, next, collations)`), then runs `steps`. Each step is an `ALTER TABLE x ADD COLUMN ...`
  built by a new `mysqlAddColumn(table, column, definition)`. It is skipped when `information_schema.columns` already
  has the column, so an upgrade that was cut off halfway finishes on the next start, as `'tables'` does today. The
  foreign keys for the new columns are added in their own steps (`ADD CONSTRAINT ... FOREIGN KEY`), each skipped when
  `information_schema.table_constraints` already has it.
- **`db-copy.ts` `TOTALS`**: add `stock_batch_moves: ['qty_milli']` and `invoice_payments: ['amount']`.
- `schema.test` keeps checking that the server SQL has no `ON CONFLICT` and no two-argument `MAX`/`MIN`.

### 1.3 Migration tests (`db.test.ts`, `db-copy.test.ts`, `schema.test.ts`)

- A file built with `migrate(db, 9)` and filled with 1.0.3-shaped data (posted invoices, a stock doc, an adjustment,
  a picture). Opening it with `openDatabase` should:
  - make the `-before-update-v9-…sqlite` copy;
  - reach version 10 with every old row unchanged;
  - read old invoice lines as base unit and no batch;
  - fill `sha256` on start-up.
- After migrating, posting, cancelling and returning an old invoice works.
- A version-10 file opened with `migrate` capped at 9 is refused with `database_newer`.
- `schema.test` parity passes, including the new triggers.
- The MySQL step list is idempotent: running `steps` against a fake db where half the columns exist emits only the
  missing ones (unit test on the step builder; no live server in CI).
- `db-copy` round trip (SQLite → SQLite through the copy path) with units, batches and payments, comparing totals.

## 2. A) Units with conversions

### 2.1 Model

- `items.unit` stays the **base unit**. Stock, average cost, `stock_moves.qty_milli`, `invoice_lines.qty_milli`,
  returns and reports all stay in base units.
- `item_units` lists the other units: factor (base per unit, in thousandths), barcode and price. An example is base
  `tablet`, `strip` 10000 and `box` 100000 (a box is 10 strips, or 100 tablets).
- A line entered in a unit stores `unit`, `unit_factor_milli` (a snapshot, so a later change of the factor never
  changes old documents), `unit_qty_milli` (as typed) and `unit_price` (the price **per chosen unit**). The amount is
  `lineAmount(unit_qty_milli, unit_price)`. The server derives `qty_milli` from the item's current factor and never
  takes a factor from the client.
- New `UnitCode` values in `core/inventory.ts` `UNITS` (ar / en / ku):

| code | ar | en | ku |
|---|---|---|---|
| ton | طن | ton | تەن |
| g | غم | g | گرام |
| bag | كيس | bag | کیسە |
| m2 | م² | m² | م² |
| dozen | درزن | dozen | دەرزەن |
| pack | باكيت | pack | پاکەت |
| strip | شريط | strip | شریت |
| tablet | حبة | tablet | حەب |
| capsule | كبسولة | capsule | کەپسوول |
| bottle | قنينة | bottle | شووشە |
| tube | أنبوب | tube | تیوب |
| ampoule | أمبولة | ampoule | ئەمپوول |
| vial | فيال | vial | ڤایل |
| sachet | ظرف | sachet | زەرف |
| roll | لفة | roll | لوول |
| pair | زوج | pair | جووت |

  `itemSchema.unit` in `routes.ts` takes its values from `Object.keys(UNITS)` (one source), not a hand-written enum.

### 2.2 Core rules (`packages/core/src/units.ts`, new; exported from `index.ts`)

- `toBaseQty(unitQtyMilli, factorMilli): number | null` returns `unitQtyMilli * factorMilli / 1000` when that is a
  whole number of thousandths, else `null` (error `unit_qty_fraction`). BigInt-safe check against
  `MAX_SAFE_INTEGER`.
- `unitPrice(base: {price}, unit: {factorMilli, salePrice|null})` uses the unit's own price, or else
  `roundHalfUp(price * factor / 1000)`.
- `priceListUnitPrice(listPrice, factorMilli)` applies a customer price list (`item_prices`, kept per base unit) to
  another unit as list price × factor.
- `validateItemUnits(base, units)`:
  - at most 10 units, no repeated unit, and the base unit not in the list;
  - factor > 0 and ≤ 1e9 thousandths;
  - barcodes unique within the item and different from the item's own barcode;
  - `sale_unit` and `purchase_unit` must be the base unit or one of the listed units.
- `splitInUnits(qtyMilli, units)` renders "3 boxes 4 strips 2 tablets" for the item card and stock lists. It is
  display only.
- `invoiceTotals` and `validateInvoice` accept lines with an optional `unit`, `unitQtyMilli`, `unitFactorMilli`. When
  a unit is present, the amount comes from the unit quantity.
- Tests in `units.test.ts`:
  - box, strip, tablet round trip;
  - gram under kg (factor 1);
  - a fractional result is refused;
  - unit price, with and without its own price;
  - price list × factor;
  - each validation error;
  - totals with mixed unit and base lines.

### 2.3 Server

- **`items.ts`**: `ItemInput` gains:
  - `units?: {unit, factorMilli, barcode?, salePrice?}[]`, `saleUnit?`, `purchaseUnit?`;
  - `categoryId?` (section 5);
  - `trackBatches?`, `trackExpiry?` (section 3).

  `createItem` and `updateItem` replace the item's `item_units` rows in the same transaction. The barcode check
  covers both tables: a unit barcode may not equal any `items.barcode` or another item's unit barcode (`barcode_taken`
  with the owner's item code). `ItemView` returns `units`, `saleUnit`, `purchaseUnit`, `categoryId`,
  `trackBatches`, `trackExpiry`.
- **Factor change.** A unit whose factor changes keeps old documents correct, because lines hold a snapshot. Removing
  a unit that open (draft) documents use returns `unit_in_use`, listing the drafts.
- **Barcode lookup** (POS scan, `GET /api/items?barcode=`): it searches `items.barcode`, then `item_units.barcode`,
  and returns `{ item, unit }`. `pos-logic.ts` `parseScan` keeps its result and adds `unit`.
- **Invoices** (`invoices.ts` `storedInput` / `assertInvoice` / line insert): lines take `unit?` and
  `unitQtyMilli?`. Without them, the request means what it means today (base quantity, base price), so old clients,
  the ext API and quotes keep working. With them, the server looks up the factor, derives `qty_milli`, and stores the
  three snapshot columns. Posting is unchanged because it uses `qty_milli`.
- **Returns** (`returns.ts`): the request stays `{ lineNo, qtyMilli }` in base units. The screen converts using the
  line's snapshot factor, and the server checks the conversion is whole. The return line copies the original line's
  unit columns, with `unit_qty_milli = qty_milli * 1000 / factor` when that is whole, else base unit.
- **POS** (`pos.ts` `SaleInput.lines`): adds `unit?` and `unitQtyMilli?`, passed through to `createInvoice`.
- **Stock docs, adjustments, purchase orders**: the same optional pair on their lines. A purchase order line's unit
  carries into the purchase invoice it makes. Stock counts stay in base units, and the count sheet shows
  `splitInUnits`.
- **Printing** (`print-model.ts`): the line shows the unit name and unit quantity when `unit` is set.
- **Labels**: `GET /api/items/:id` already gives the units. Each label row takes a unit, and the label uses that
  unit's barcode and price.
- **Ext API**: `ExtItem.units: {unit, factorMilli, barcode, price}[]`. `POST /orders` lines accept `unit?`.

### 2.4 Screens (`apps/web`)

- **`Items.tsx` ItemForm**:
  - "Units" section: a table of unit, "= N <base>", barcode and price, plus default sale and purchase unit pickers;
  - category select;
  - batch and expiry switches;
  - the item card shows stock with `splitInUnits`.
- **`Invoices.tsx`**: each line gets a unit select (base and the item's units), which defaults to the item's
  sale/purchase unit. The price comes from the unit and the customer's price list. Changing the unit re-prices the
  line. The return dialog asks for the quantity in the line's unit.
- **`Pos.tsx`**: a unit chip on each cart line (tap to cycle). Scanning a unit barcode adds that unit.
- **`StockDocs.tsx`, `StockAdjustments.tsx`, `PurchaseOrders.tsx`, `Labels.tsx`**: a unit select.
- **i18n**: unit names come from `UNITS`. New texts go in `i18n/units.ts`.

### 2.5 Tests (server `units.test.ts`, web `Invoices.test.tsx` additions)

- A purchase of 2 boxes puts 200 tablets in stock, valued at the line amount.
- A sale of 3 strips and 5 tablets takes 35 tablets, with cost at average.
- Returning 1 strip.
- Cancelling the sale.
- POS sale by unit barcode.
- Changing a unit's factor leaves posted lines unchanged.
- Duplicate barcode across items and units is refused.
- A draft blocks removing a unit.
- A request without a unit behaves exactly as in 1.0.3 (regression).

## 3. B) Batches and expiry dates

### 3.1 Rules

- **Opt-in per item.** `track_batches` keeps stock per batch number. `track_expiry` also requires an expiry date on
  the way in, and implies `track_batches`.
- **Value is unchanged.** Average cost per item and warehouse stays as it is. Batches carry **quantity only**, and a
  batch's value in reports is quantity × the item's average cost.
- **Invariant.** For a batch item, per warehouse, `SUM(stock_batch_moves.qty_milli)` equals
  `SUM(stock_moves.qty_milli)` from the time tracking was switched on. A test checks it after every operation in the
  batch test suite.
- **Switching tracking on** for an item with stock writes `batch_start` moves into the item's `''` batch (no number,
  no expiry) for the difference per warehouse. This covers both the first time and switching it on again. Switching
  it off is always allowed; batches are then simply not consulted.
- **Inbound lines** (purchase, opening stock, adjustment in, sale return): `batch_no` and `expiry`. On posting, the
  server finds or creates `item_batches(item_id, number)`. An existing number with a different expiry returns
  `batch_expiry_differs`. A missing expiry on a `track_expiry` item returns `expiry_required`. An expiry before the
  document date gives a warning, not an error, because expired stock can be received for a return to the supplier.
- **Outbound lines** (sale, POS, adjustment out, transfer out, purchase return): `batch_id` pins one batch. Without
  it, **FEFO** applies: earliest expiry first, NULL expiry last, ties by `created_at`. One line may take from several
  batches; each part is one `stock_batch_moves` row with the line number.
- **Expired stock** (`expiry < document date`), controlled by the setting `expired_sales`:
  - `block` (default) means FEFO skips expired batches, and pinning an expired batch on a sale or POS line returns
    `batch_expired`.
  - `warn` means FEFO still prefers good batches. Expired ones are used only when the request carries
    `allowExpired: true`, which the screen sends after the user confirms. Each such sale is written to the audit log
    (`sell_expired`).
  - Adjustments out (write-off) and purchase returns may always take expired batches.
- **Transfers** move the same batch ids from one warehouse to the other (FEFO or pinned).
- **Cancel** writes the negated batch moves of the source (`<type>_cancel`).
- **Sale return** puts quantity back into the batches the original line took, in reverse pick order, minus what
  earlier returns already put back. **Purchase return** takes from the batch the purchase line brought in, and
  returns `batch_insufficient` if that batch no longer holds enough.
- **Stock count** on a batch item: a shortage is taken FEFO (expired first is allowed). A surplus goes into the `''`
  batch, unless the count line names a batch. Counting per batch is out of scope.
- **Settings** (`settings.ts`, new keys, defaults filled in `ensureDefaults`):
  - `near_expiry_days` (default 90, range 1–730);
  - `expired_sales` (`block` | `warn`);
  - `default_track_expiry` (0/1). New items start with it. Choosing the pharmacy business type sets it to 1.

### 3.2 Core (`packages/core/src/batches.ts`, new)

- `pickFefo(batches: {id, expiry: string|null, createdAt, qtyMilli}[], needMilli, date, policy: 'block'|'warn',
  allowExpired) → {ok: true, picks: {id, qtyMilli}[], usedExpired: boolean} | {ok: false, code:
  'batch_insufficient'|'batch_expired', availableMilli}`
- `returnToBatches(taken: {id, qtyMilli}[], alreadyBack: Map, qtyMilli)`: reverse pick order.
- `expiryState(expiry, today, nearDays): 'expired'|'near'|'ok'|null`
- `isIsoDate`-checked expiry, with `normalizeBatchNo` (trim, collapse spaces, NFKC, Arabic-Indic digits to Western,
  max 40).
- Tests in `batches.test.ts`:
  - FEFO order, NULL last, ties;
  - a split over batches;
  - expired skipped under block;
  - expired used only with allowExpired under warn;
  - insufficient stock;
  - return order;
  - state boundaries (an expiry of today is not expired; tomorrow minus nearDays).

### 3.3 Server

- **New `batches.ts`**:
  - `ensureBatch`;
  - `batchStock(itemId, warehouseId)`;
  - `allocateOut(...)` uses `pickFefo` over `batchStock`;
  - `writeBatchMoves`;
  - `reverseBatchMoves(sourceType, sourceId)`;
  - `startTracking(itemId)`.

  These are called inside the existing posting transactions of:
  - `postInvoice` / `cancelInvoice` (`invoices.ts`);
  - `createReturn` (`returns.ts`);
  - `postStockDoc` / `cancelStockDoc` (`stock-docs.ts`);
  - `postAdjustment` / `cancelAdjustment` and count finishing (`adjustments.ts`);
  - `sell` (`pos.ts`, through `postInvoice`).

  Errors are collected per line in the same form as `stock_insufficient` (`{code, line, available}`).
- **Reports**:
  - `batchReport(f: {itemId?, warehouseId?, state?: 'expired'|'near'|'all'})` returns rows: item, batch, expiry,
    warehouse, qty, value at average cost, days left. `branchOf` limits warehouses for branch users, as other stock
    reads do.
- **`brief.ts`**: `BriefView.expiry = { expired: n, near: n, top: rows (5) }`, only when some item tracks expiry.
- **Write-off**: `POST /api/batches/write-off { warehouseId, rows: [{batchId, qtyMilli}] }` creates a **draft**
  adjustment, reason `expired`, with lines pinned to those batches. It is then posted as any other adjustment.
- **Routes** (`routes.ts` or a new `batchesApi` in `features.ts`):

| Route | Rule |
|---|---|
| `GET /api/batches?itemId=&warehouseId=` | signed-in (reads open, as today) |
| `GET /api/batches/report?state=&warehouseId=&itemId=` | signed-in |
| `PUT /api/batches/:id` (fix number/expiry; refused once the batch has any outbound move, `batch_in_use`) | `stock` |
| `POST /api/batches/write-off` | `stock` |

  Invoice, stock doc, adjustment and POS schemas gain `batchNo` (max 40), `expiry` (`isoDate`), `batchId` (max 64)
  per line, and `allowExpired` (boolean) on sale, POS and post requests.

### 3.4 Screens

- **ItemForm**: switches for "Track batches" and "Track expiry date".
- **Item card**: a "Batches" tab (batch, expiry with a colour state, quantity per warehouse).
- **Purchase invoice and opening stock lines**: batch number and expiry inputs, shown only for tracking items.
- **Sale, POS and transfer lines**: an optional batch select, "Automatic (earliest expiry)" by default, showing each
  batch's expiry and quantity.
- **Expired-batch confirmation** under `warn`: a confirm dialog (in-app, RTL-aware), which then sends
  `allowExpired`.
- **New page `Expiry.tsx`** (nav `gStock`, key `ex_title`, path `expiry`), with three tabs: near expiry, expired, and
  batch stock. Each tab has filters, CSV export (`downloadCsv`) and print. "Write off" on the expired tab opens the
  draft adjustment.
- **Brief.tsx**: an alert card ("N batches expired, M expire within 90 days"), linking to `expiry`.
- **Settings → Stock**: near-expiry days, expired sales policy, and expiry tracking for new items.
- **i18n**: `i18n/batches.ts`. A guide topic in `core/guide.ts`.

### 3.5 Tests (server `batches.test.ts`)

- A purchase with two batches, then a FEFO sale across both.
- A pinned batch.
- Expired: blocked; under warn without and with `allowExpired` (with an audit row).
- Write-off of an expired batch.
- A transfer keeps batch ids.
- A sale return goes back into the right batches.
- A purchase return from the purchase's batch.
- Cancelling each document type.
- Switching tracking on with stock creates the `''` batch.
- A count shortage and a surplus.
- The invariant after every step.
- A branch user sees only their warehouses in the report.
- The Brief alert.
- MySQL-safe SQL (no `ON CONFLICT`, no two-argument `MAX`/`MIN`).

## 4. C) Pharmacy pack (Pro)

### 4.1 Gating, the same as the other packs

- **`core/plans.ts`**:
  - `Feature` gets `'pharmacy'`, which is added to `PRO_FEATURES` (so Business and the trial have it too);
  - `BUSINESS_TYPES` gets `'pharmacy'`;
  - `BUSINESS_FEATURE.pharmacy = 'pharmacy'`.

  `business-type.test` and the plans tests are updated.
- **Pro service.** `pro/src/pharmacy/service.ts` has
  `available = (db) => planStatus(db).features.includes('pharmacy')` and `requirePlan` on every read and write
  (`conflict('plan_limit', { limit: 'pharmacy' })`), as in `parts/service.ts`. `pharmacyApi` is added to `proApi` in
  `pro/src/api.ts`.
- **Web.** The nav item is `{ key: 'ph_title', icon: 'pill', path: 'pharmacy', match: ['pharmacy'], business:
  'pharmacy' }` in `gIndustry`. `BusinessType.tsx` gets a card (`bt_pharmacy`, `bt_pharmacyText`). An icon
  `pill` is drawn in-house in the components' icon set, so no third-party asset is needed.
- **Without Pro.** Units and batches still work, because they are core. The pharmacy page shows the usual plan notice.

### 4.2 Data and rules (`pharma_details`, `pharma_controlled_log`)

- **Item fields**: generic (scientific) name, dosage form, strength (free text, max 60, e.g. "500 mg"),
  manufacturer, prescription-only, controlled, and shelf location. `generic_key = normalizeForSearch(generic_name)`.
- **Alternatives**: other active items with the same `generic_key`. Those with the same strength and form come
  first, then items with stock, then by name. Each shows price, stock and nearest expiry.
- **Search** (`GET /api/pharmacy/search?q=`): matches name (three languages), code, barcode, unit barcodes, and the
  generic name, on normalized text through SQL `LIKE` with `!` escape. Limit 50.
- **Prescription-only** items show a badge and a "prescription seen" tick on POS and the sale invoice. This is a
  reminder and is not enforced.
- **Controlled items**:
  - After a sale is posted (POS or invoice), the page asks for patient name (required), prescriber and prescription
    number for each controlled line, and saves them with `PUT /api/pharmacy/controlled/:invoiceId/:lineNo`.
  - The **controlled log** lists every posted, not cancelled sale line of a controlled item: date, invoice, item,
    quantity and batch, with the recorded details. Missing details show in red so they can be filled in later.
  - The log can be printed and exported to CSV.
- **Near-expiry list**: the batch report (section 3) filtered to items with `pharma_details`.

### 4.3 API (`pro/src/pharmacy/api.ts`)

| Route | Rule |
|---|---|
| `GET /api/pharmacy/items?q=&form=&rx=&controlled=&limit=&offset=` | signed-in |
| `GET /api/pharmacy/items/:id` (details + alternatives) | signed-in |
| `PUT /api/pharmacy/items/:id` (zod: lengths, `form` enum, booleans) | `stock` |
| `GET /api/pharmacy/search?q=` | signed-in |
| `GET /api/pharmacy/controlled?from=&to=&missing=1` | signed-in |
| `PUT /api/pharmacy/controlled/:invoiceId/:lineNo` (line must be a posted sale line of a controlled item) | `sales` |

### 4.4 Screens

- **`apps/web/src/pages/Pharmacy.tsx`** and `industry/pharmacy-api.ts`, with four tabs:
  - Medicines: list with generic, form, strength, shelf, Rx/controlled badges, stock in units and nearest expiry, plus
    an edit dialog;
  - Alternatives: search by generic name;
  - Near expiry;
  - Controlled log.
- **`Pos.tsx`**: when the business type is pharmacy, the search box also calls `/api/pharmacy/search`. Results show
  the generic name and shelf. A line can show its alternatives. Rx and controlled prompts appear as above.
- **i18n**: `i18n/pharmacy.ts`. Guide topic `pharmacy`.
- **Demo seed** (`seed-demo.ts`, pharmacy branch only): a few medicines with box/strip/tablet units and batches, sold
  to Mer, Las and Raz.

### 4.5 Tests (`pro/src/pharmacy/pharmacy.test.ts`)

- Plan gating: Free is refused, the trial is allowed.
- Save and validate details.
- Alternatives ordering.
- Search by generic name with Arabic and Kurdish normalization.
- Controlled log: a missing entry is flagged, recording is refused for a non-controlled or unposted line, and a
  cancelled sale drops out.
- Permissions: `stock` for details, `sales` for the log.
- `sql-portability.test` covers the new SQL.

## 5. D) Qasa Store API needs (Pro, `pro/src/webapi`)

All of these sit inside the existing ext API (`/api/v1/ext/*`). That API works the same over the sealed relay
(`PATH` already allows the new paths) and directly, with key, scope and rate checks in `keyOf`.

### 5.1 Item categories (app, every plan)

- **Table and service.** Table `item_categories` (section 1), in a new `packages/server/src/categories.ts`:
  - `listCategories`;
  - `createCategory` (code auto `C001…` when empty, names required in at least one language, max 200 each);
  - `updateCategory`;
  - `deleteCategory` (refused `in_use` while items use it; deactivate instead).

  `items.category_id` is set from the item form or in bulk.

| Route | Rule |
|---|---|
| `GET /api/item-categories` | signed-in |
| `POST /api/item-categories` | `stock` |
| `PUT /api/item-categories/:id` | `stock` |
| `DELETE /api/item-categories/:id` | `stock` |
| `POST /api/items/category` `{ itemIds: string[≤500], categoryId: string|null }` | `stock` |

- `GET /api/items?categoryId=` filter. Items import and export get a `category` column with the category code.
- **Screens**: in `Items.tsx`, a "Categories" tab (list, add, rename in three languages, order, deactivate), a
  category filter, and a bulk "Set category" action on selected rows.
- **Ext.** `GET /api/v1/ext/categories` (scope `items:read`) returns `[{ id, code, name: {ar, en, ku}, sort }]`,
  active only. `ExtItem.category: { id, code, name } | null`.

### 5.2 `ExtItem` and webhook additions

- `trackStock: boolean` (from `items.track_stock`).
- `categoryId` / `category`, as above.
- `imageSha256: string | null` and `imageUpdatedAt: string | null`, from `item_images.sha256` and
  `item_images.updated_at`. `media.ts` sets `sha256` whenever a picture is saved.
- `units` (section 2).
- `updatedAt` (`items.updated_at`, set by create and update). This is groundwork for incremental sync; the
  `updatedSince` filter is not in 1.1.
- Stock for a batch item with `expired_sales = block` excludes expired batches, so the shop never sells expired
  stock. `stockMilli` is the sellable quantity, with `expiredMilli` beside it.
- `stock.changed` items carry `trackStock`. The watcher (`WebhookWatcher.look`) also sends `stock.changed` when an
  item's `track_stock` flips.

### 5.3 `created` on `POST /api/v1/ext/orders`

- The body becomes `{ ...ExtOrder, created: boolean }`. The status stays 201 or 200, so existing clients are
  unaffected. The WooCommerce plugin and `QasaClient.php` ignore extra fields; the tests check this.

### 5.4 Recording an online payment on an order

- **New scope `payments:write`** in `SCOPES`, with label texts in the three languages. A key made before 1.1 does not
  have it, and the shop shows `api_scope_missing` until the owner makes a key with it. The "Qasa Store" choice on the
  key form ticks `items:read`, `stock:read`, `customers:write`, `orders:write` and `payments:write`.
- **Payment accounts.** Settings → Website API gets "Online payment accounts": method → safe or bank account (an
  active 18x account), stored as the setting `webapi_payment_accounts` (JSON, validated on write). It is changed
  through `PUT /api/webapi/payment-accounts`, which is admin only, like the other webapi admin routes.
- **Route.** `POST /api/v1/ext/orders/:externalId/payments`, body:
  `{ source?: text(50), method: 'fib'|'zaincash'|'qi'|'card'|'other', amount: money>0, currency: 'IQD'|'USD',
  reference: text(100).min(1), paidAt?: date, notes?: text(300) }`.
  1. The order is found by `(source, externalId)` (`not_found` otherwise). A cancelled invoice returns
     `order_cancelled`.
  2. If `(source, reference)` already exists, the same amount, currency and order returns the existing payment with
     `created: false` (status 200). Any other difference returns `409 reference_taken`.
  3. `currency` must equal the invoice's (`currency_mismatch`). The amount must be at most the invoice total minus
     the online payments already recorded (`overpayment`, with `openAmount`). A missing account mapping for the
     method returns `409 payment_account_missing`.
  4. In one transaction:
     - a **draft receipt voucher** through `createVoucher`: debit the mapped account, credit the invoice customer's
       account with `partyId`; the description is "Online payment <method> <reference> — website order
       <externalId>"; date `paidAt` or today; rate from the invoice;
     - an `invoice_payments` row (`kind 'online'`, `entry_id`, `source`, `reference`);
     - an audit row.

     The voucher is left as a draft so a person checks and approves it through the normal
     preparer/checker/approver steps. An API key never makes an approved money entry.
  5. The answer is 201 `{ id, externalId, source, method, amount, currency, reference, entryId, entryNumber: null,
     status: 'draft', created: true }`.
- **Reading back.** `GET /api/v1/ext/orders/:externalId` adds `payments: [{ method, amount, currency, reference,
  status }]` (the voucher's status: draft, checked or approved) and `paidAmount`.
- **App screen.** The invoice detail lists its `invoice_payments` with links to the receipt vouchers. The invoices
  list shows a "paid online" chip.

### 5.5 Tests (`webapi.test.ts`, `sealed.test.ts`, `php-relay.test.ts`)

- The categories route needs scope `items:read`, and only active categories are listed.
- ExtItem fields: `trackStock` for a service item, the image hash changes with the picture, category, units, and
  expired stock left out.
- `stock.changed` on a `track_stock` flip.
- `created` true, then false.
- Payments:
  - the scope is required;
  - idempotent replay;
  - `reference_taken`, `currency_mismatch`, `overpayment`, `order_cancelled`, `payment_account_missing`;
  - the voucher is a draft with the right accounts and party;
  - the party balance after the invoice is posted and the voucher approved.
- The same calls go through the sealed path.
- The PHP client test parses `created`.

## 6. E) From gaps.md

### 6.1 USD balances for customers and suppliers (in scope)

No schema change is needed. `entry_lines.debit/credit` are already in the entry's currency (`entries.currency`).

- **`parties.ts`**: `PartyView.balances: { IQD: number; USD: number }` is the sum of party lines grouped by entry
  currency, in the party's direction. `balance` (IQD at book rates) stays the official total.
- **`partyStatement(..., { currency?: 'IQD'|'USD' })`**: with a currency, it gives only that currency's lines, with
  a running balance in that currency. Without one, it gives what it gives today, plus a `currency` column and the
  line amount in its own currency.
- **`brief.ts` `aging`**: adds a `usd` open balance per row (no buckets for USD in 1.1).
- **Screens**:
  - `Parties.tsx`: a USD column when any party has USD movement;
  - the statement gets a currency switch (all / IQD / USD);
  - the printed statement and the WhatsApp statement (`share.ts`) use the chosen currency;
  - `Reports.tsx` statement report: the same switch.

  Statements of USD safes and banks (`statementReport`) get the same per-currency running balance.
- **Known limit, shown as a hint on the statement.** A receipt in IQD against a dollar debt lowers the IQD column
  and leaves the USD one. The total at book rates is the reference. Currency exchange is a medium gap that is not in
  1.1.
- **Tests** in `parties.test.ts`: mixed IQD/USD sales and receipts; balances per currency; the USD running balance;
  a branch user.

### 6.2 POS payment methods and split payments (in scope)

- **Methods**: cash (the shift's safe), card, FIB, ZainCash, Qi, and "on account" (credit to the chosen customer,
  checked against the customer's credit limit).
- **Setting `pos_payment_accounts`** (JSON method → active 18x account). It is admin only, through the existing
  `PUT /api/pos/settings`, or a new route with rule `admin`. A method without an account is hidden at the counter.
- **Server.** `SaleInput.payments?: [{ method, amount }]` (1–4 parts). They must sum to the sale total
  (`payments_total_mismatch`). "On account" requires `partyId`. With no `payments`, the sale is all cash, as today.
- **Posting.** `postInvoice` gets an internal option `split: { accountCode, amount, partyId? }[]`, the same as
  `settledNow`: internal callers only, never from a request. The sale's debit side becomes one line per part, instead
  of the single cash or customer line. The credit-limit check uses only the on-account part. `invoice_payments` rows
  (`kind 'pos'`, `entry_id` = the sale entry) are written in the same transaction. Cancelling reverses the whole
  entry, which needs no change.
- **Shift.** `expected_cash` and `expected_usd` count only the cash parts (from `invoice_payments` where present,
  else the whole cash sale, as in 1.0.3). The shift report lists totals per method.
- **Screen** (`Pos.tsx`): the pay dialog has method buttons, a split ("add another method"), the amount left, and the
  customer picker for on account. The receipt prints each part.
- **Tests** in `pos.test.ts`:
  - all cash is unchanged;
  - card + cash split posts to two accounts;
  - on account hits the customer with the credit-limit check;
  - a mismatched total is refused;
  - a hidden method is refused;
  - the shift's expected cash counts only cash;
  - cancel and return of a split sale.

### 6.3 Gaps from gaps.md that 1.1 will NOT do

The high-priority ones not listed in sections 2 and 6 already shipped in 1.0.3: trial balance opening column, backups
on every plan with a copy before updates, admin recovery code, and stock count sessions. None of the medium gaps are
in 1.1:

- List caps (500 rows), date filters, paging, SQL search and CSV on every list.
- Partial payment at invoice time, due dates, paid/open status, and aging by due date.
- Read permissions for reports, costs and banking. Reads stay open to every signed-in role, as in 1.0.
- Licence, trial and backup warning banners, translated backup errors, and the same-disk warning.
- Keeping the open invoice or POS cart when the session expires (sign-in dialog and retry).
- General journal and ledger page, cash flow statement for a period, and branch filter on final accounts.
- Fiscal-year settings: year picker for locking, month/day dropdowns, and an audit log page with filters.
- Min and max reorder levels on general items.
- Item card labels and links for adjustment and count moves.
- Item import/export price and currency columns, "update existing" import, and the missing warehouse, item delete
  and trial-balance-import screens.
- Currency exchange form with FX gain/loss, and cheque endorsement.
- POS customer price lists in POS and quotes, USD opening float, and posting the closing difference. The 1.1 POS
  work adds payment methods only; price lists apply to units on invoices.
- Company header and footer on purchase orders, installments and stock documents, and these documents in the print
  designer.
- Backdated stock documents and forward cost recomputation.
- Landed cost.
- Payroll employer social security and tax withheld.
- Industry-pack loose ends: IMEI at sale, return and transfer; progress bills; generator and real estate screens;
  installment late fees.

From the store's list (store/docs/PLAN.md §11), these are also not in 1.1:

- one connection code;
- `updatedSince` incremental sync (only `updatedAt` is added);
- stock reservation by web drafts;
- cancel from the shop;
- item descriptions;
- `GET /orders?source=` for the last number;
- webhook registration by API.

## 7. Permissions summary (all new change routes)

| Route | Rule |
|---|---|
| `POST/PUT/DELETE /api/item-categories[/:id]`, `POST /api/items/category` | `stock` |
| `PUT /api/batches/:id`, `POST /api/batches/write-off` | `stock` |
| `PUT /api/pharmacy/items/:id` | `stock` |
| `PUT /api/pharmacy/controlled/:invoiceId/:lineNo` | `sales` |
| POS payment accounts, near-expiry and expired-sales settings, `PUT /api/webapi/payment-accounts` | `admin` |
| `POST /api/v1/ext/orders/:externalId/payments` | API key with `payments:write` (listed in `public`) |
| `GET /api/v1/ext/categories` | API key with `items:read` (listed in `public`) |

Existing rules keep covering line changes: items `stock`, invoices by kind, stock docs `stock`, POS `sales`. Every
new GET is open to signed-in users, as all reads are in 1.0, and branch-limited users get warehouse-filtered results
through `branchOf` / `warehouseSql`. `nav-admin.test` and `route-targets.test` are extended for the new pages.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Posted-document triggers block any backfill of the new line columns | No backfill. NULL means base unit and no batch. Tested on a 1.0.3 file |
| MySQL column order or FK order differs from SQLite and `schema.test` fails, or a fresh server db fails on `items → item_categories` | New columns are appended last in both. `item_categories` is listed before `items` in `MYSQL_TABLES`. The parity test runs in CI |
| Upgrade of a server db cut off halfway | Each ALTER and constraint step is skipped when it already exists (information_schema), so the next start finishes it |
| Batch quantity drifts from stock quantity | One module (`batches.ts`) writes all batch moves inside the same transactions. The invariant is asserted throughout the batch tests. `startTracking` re-syncs |
| Rounding of unit prices and fractional base quantities | Unit price per unit is stored and the amount comes from unit quantity. Base quantity must be whole thousandths or the line is refused |
| Barcode collisions between item and unit barcodes | Checked across both tables in the item transaction, plus a unique index on `item_units.barcode` |
| Expired-sales `block` stops a counter sale | The clear message names the batch and expiry. The admin can switch to `warn`. Write-off is one click from the expiry page |
| An API key creating money entries | Separate `payments:write` scope; the voucher is a draft for a person to approve; idempotent by reference; amount capped by the open amount; currency must match |
| A dollar debt paid in dinars looks odd in the USD column | Hint on the statement. The total at book rates stays the official figure. The exchange feature comes later |
| Microsoft Store build one release behind cannot open 1.1 books | `refuseNewer` already says so plainly. The Store submission ships with the release |
| The website demo (`apps/web/src/demo`) runs server routes in the browser | Run the demo backend tests. The new routes use only the `Db` interface |
| Scope creep | Section 6.3 is the fence. Anything else goes to 1.2 |

## 9. Build order (one pass, commit per step, tests green at each)

1. Branches: `feature/1.1` in the app (from `fix/rtl-display`) and in `pro/` (from `main`).
2. **Core**:
   - `units.ts`, `batches.ts`, the `UNITS` additions;
   - `invoices.ts` unit lines;
   - `plans.ts` pharmacy;
   - guide topics;
   - `APP_VERSION = '1.1.0'` (with `apps/desktop/package.json`).

   Tests.
3. **Schema**: V10 SQLite, `schema-mysql.ts`, the `Migration.mysql` steps form, `db-copy` totals, `ensureDefaults`
   (settings, sha256 fill). Migration, parity and copy tests.
4. **Server, units and categories**:
   - `items.ts`;
   - `categories.ts`;
   - invoice, return, stock doc, adjustment, PO and POS line units;
   - barcode lookup;
   - print model.

   Tests.
5. **Server, batches**: `batches.ts`, wired into every posting, cancel and return path; reports; brief; write-off;
   routes and settings. Tests.
6. **Server**: USD balances (`parties.ts`, statements, aging) and POS payments (`pos.ts`, the `postInvoice` split).
   Tests.
7. **Pro**: webapi (categories, ExtItem fields, `created`, `payments:write`, payment accounts, webhook flag) and
   `pharmacy/` (service, api, registration). `npx tsc --noEmit -p .` and `npx vitest run` in `pro/`.
8. **Web**:
   - Items (units, category, batches, categories tab);
   - Invoices, Pos, StockDocs, StockAdjustments, PurchaseOrders, Labels;
   - Expiry page and Brief card;
   - Settings;
   - Parties and Reports USD;
   - WebsiteApi additions;
   - Pharmacy page and BusinessType card;
   - i18n files (ar/en/ku) and nav.

   Web tests: `release-texts`, i18n, `nav-admin`, `route-targets`, `rtl-*`, `sample-names`, plus new page tests.
9. **Demo seed** (units and batches for trade, the pharmacy sample with Mer, Las and Raz) and release notes
   (`release-notes.ts`, three languages).
10. Full checks: `npm test`, `npm run typecheck` (app), and the same in `pro/`. Do not push, merge or tag.
