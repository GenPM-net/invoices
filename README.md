# @core/invoices

[![genpm](https://api.genpm.net/v1/badge/@core/invoices.svg)](https://genpm.net/p/@core/invoices) ![license](https://img.shields.io/badge/license-MIT-blue)

> Spanish invoices from paid orders: legal numbering, simplified/full, credit notes and VeriFactu-style hash chain

A [GenPM](https://genpm.net) module: **source code + AI rules + MCP config**, injected into your project instead of hidden in `node_modules`. The code lands in `src/lib/invoices`, pinned to a verified commit, and you own it.

## Install

```bash
genpm add @core/invoices
```

No genpm yet? `curl -fsSL https://genpm.net/install.sh | sh` (macOS/Linux), `irm https://genpm.net/install.ps1 | iex` (Windows), or one-off with `npx @genpm-net/cli add @core/invoices`.

Or let your AI agent do it: run `genpm mcp setup` once, then ask *"add @core/invoices with genpm"* in Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI. It shows you a dry-run plan before writing anything.

## What it does

Spanish invoices for paid orders (@core/orders): correlative numbering per series and year without gaps, simplified
invoice up to the legal limit and full invoice above it, credit notes (rectificativas por diferencias) for refunds in
their own series, full invoices that replace simplified ones when the customer gives their tax details, printable HTML
with the mandatory content, and VeriFactu-style registration records: each record carries the SHA-256 hash of the
previous one (format verified against the AEAT example) and the AEAT verification QR URL. Invoices are never edited
or deleted. Tables: `invoices`, `invoice_counters`, `invoice_records`.

**Scope of 1.0 (tell the person):** this package prepares the data required by RD 1007/2023 and Order HAC/1177/2024,
but it does not yet sign records (non-VeriFactu mode) nor send them to the AEAT (VeriFactu mode), and it is not a
certified billing system. Deadlines changed several times. In force (BOE, RD-ley 15/2025): billing systems adapted
before 1 Jan 2027 (corporate income tax payers) and 1 Jul 2027 (everyone else). On 5 Oct 2026 the Ministry announced
a planned move to October 2028, not yet published in the BOE (checked 7 Oct 2026). Check the current official
calendar with the AEAT or a tax advisor before relying on either date.

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/orders](https://genpm.net/p/@core/orders), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **Environment variables** (added to `.env.example`): `INVOICE_ISSUER_NIF`, `INVOICE_ISSUER_NAME`, `INVOICE_ISSUER_ADDRESS`, `INVOICE_SERIES`, `INVOICE_VAT_RATE`, `INVOICE_RETAIL`, `INVOICE_QR_ENV`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/invoices`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
