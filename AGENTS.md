# @core/invoices — rules for AI agents

## Purpose
Spanish invoices for paid orders (@core/orders): correlative numbering per series and year without gaps, simplified
invoice up to the legal limit and full invoice above it, credit notes (rectificativas por diferencias) for refunds in
their own series, full invoices that replace simplified ones when the customer gives their tax details, printable HTML
with the mandatory content, and VeriFactu-style registration records: each record carries the SHA-256 hash of the
previous one (format verified against the AEAT example) and the AEAT verification QR URL. Invoices are never edited
or deleted. Tables: `invoices`, `invoice_counters`, `invoice_records`.

**Scope of 1.0 (tell the person):** this package prepares the data required by RD 1007/2023 and Order HAC/1177/2024,
but it does not yet sign records (non-VeriFactu mode) nor send them to the AEAT (VeriFactu mode), and it is not a
certified billing system. Deadlines changed several times (RD-ley 15/2025 set 2027; in October 2026 the Ministry
announced a move to October 2028): check the current official calendar with the AEAT or a tax advisor.

## Map
- `index.ts` — `invoiceOrder`, `rectifyRefund`, `replaceSimplified`, `verifyChain`, `invoiceHtml`, `invoiceQrUrl`, `invoicesAdminResource`.
- `invoices.ts` — issuing and order events. `verifactu.ts` — hash input, hash, Madrid dates, amounts, QR URL. `html.ts` — printable invoice.

## Integration
1. Env: `INVOICE_ISSUER_NIF`, `INVOICE_ISSUER_NAME`, `INVOICE_ISSUER_ADDRESS`; optional `INVOICE_SERIES` (default `A`;
   credit notes use `<series>R`), `INVOICE_VAT_RATE` (default 21, prices include VAT), `INVOICE_RETAIL=1` (simplified
   limit 3,000 € instead of 400 €), `INVOICE_QR_ENV=test` while testing.
2. Migrations as in `src/lib/db/AGENTS.md`. Import `@/lib/invoices` once at startup (e.g. `src/genpm/commerce.ts`):
   it issues invoices when orders are paid and credit notes when they are refunded (background jobs, retried).
3. Admin: add `invoicesAdminResource({ printPath: (i) => \`/invoices/${i.number}\` })` to `src/genpm/admin.ts`.
4. Printable page for the owner (protected by `invoices:read`) or the customer (signed order link):
   return `new Response(invoiceHtml(inv, { qrImageSrc }), { headers: { 'content-type': 'text/html' } })`. Generate the QR
   image from `invoiceQrUrl(inv)` with a QR library in the app.
5. Verify: pay a test order → invoice `A<year>-000001`; refund part → credit note `AR<year>-000001` with a negative total;
   `verifyChain(nif)` returns `ok: true`.

## Conventions
- All lines use one VAT rate in 1.0; mixed rates (reduced, exempt) need per-line taxes before using this package.
- Issue invoices in EUR only; convert other currencies before.
- Keep invoices and records at least as long as tax law requires (typically 4–6 years); never prune these tables.

## Don't
- Don't edit, renumber or delete invoices or records; correct with credit notes.
- Don't print "VERI*FACTU" on invoices until records are actually sent to the AEAT.
- Don't present this package as certified or as legal/tax advice.
