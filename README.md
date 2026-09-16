# B2B Wholesale Payment Reconciliation & Cash Application Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org/)
[![ISC License](https://img.shields.io/badge/License-ISC-yellow.svg)](LICENSE)

An enterprise-grade, idempotent financial reconciliation engine designed for B2B wholesale distribution and merchant payment platforms (e.g., Freely Payments, MarginEdge). Built in **TypeScript** with strict double-entry ledger verification.

> **TL;DR** — Wholesale distributors bleed money on messy payments: lump-sum remittances spread across multiple invoices, short-paid deductions with no warning, and double-posted cash from flaky webhooks. This engine fixes all three — it allocates every payment to the right invoices, auto-triages disputes into credit memos, and guarantees the ledger always balances. As a bonus, it emits Level 3 interchange data that cuts card processing fees from ~2.9% to ~1.6%.

## Quick Start

```bash
git clone https://github.com/djjrip/freely-reconciliation-engine.git
cd freely-reconciliation-engine
npm install

# Run the test suite
npm test

# Build + run the dashboard server
npm run build
npm run dashboard

# Run throughput benchmarks
npm run benchmark
```

## Project Structure

```
src/
├── reconciliationEngine.ts  # Core remittance allocation & invoice matching
├── sagaWorkflow.ts          # Settlement saga orchestration with compensation
├── erpStore.ts              # ERP persistence: ledger, journal entries
├── server.ts                # HTTP API + webhook ingestion (dashboard)
├── benchmark.ts             # Throughput benchmarks
└── types.ts                 # Domain types: invoices, payments, journal entries
__tests__/                   # Jest suite: idempotency, disputes, L3 payloads
docs/
└── architecture-comparison.md
```

---

## The Core Problem in Food & Beverage Distribution
Wholesale broadline distributors (produce, meat, seafood) operate on thin net margins (1% to 3%). Their payment receivables face two chronic bottlenecks:
1. **Lump-Sum Multi-Invoice Settlements:** Restaurants submit single ACH/Card remittances that cover parts of several past-due invoices.
2. **Short-Pay Deductions (Disputes):** Food deliveries frequently encounter damaged goods, temperature excursions, or pricing discrepancies. Restaurants deduct disputed amounts directly from their payment without notifying the vendor in advance, leaving open "zombie balances" in distributor ERPs.
3. **Double-Posting Risk:** Brittle webhook deliveries and network timeouts to ERP APIs (NetSuite, QuickBooks, specialized distributor software) can cause cash to be applied twice or journal entries to be duplicated.

---

## Architectural Topology

```
[ Inbound Payment / Webhook ]
            │
            ▼
┌───────────────────────────────────────┐
│       1. Strict Idempotency Check     │  (Deterministic transaction keys prevent double-application)
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│     2. Remittance Allocation Engine   │  (Matches claims against open invoice ledger)
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│    3. Automated Short-Pay Triaging    │  (Creates vendor credit memos for damaged/shorted items)
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│    4. Balanced Double-Entry Ledger    │  (Debits Cash & Allowances; Credits Accounts Receivable)
└───────────────────┬───────────────────┘
                    ▼
┌───────────────────────────────────────┐
│  5. Level 3 Interchange Optimization   │  (Generates L3 line items to lower interchange fees to ~1.6%)
└───────────────────────────────────────┘
```

### 1. Level 3 Interchange Optimization (ISO 8583 Data Enrichment)
For card-settled transactions, the engine aggregates invoice line items (SKUs, quantities, commodity codes) into standard **Level 3 Interchange Payloads**. This triggers card network qualification that lowers merchant processing interchange fees from ~2.9% down to ~1.6%.

### 2. Automated Dispute Isolation & Credit Memos
When an invoice is short-paid:
* The engine verifies the deducted amount against the claimed line-item discrepancy.
* It closes out the open invoice balance as `DISPUTED` while isolating the deduction into a formal `CreditMemo` tagged with a categorized `DisputeReason` (`DAMAGED_GOODS`, `PRICING_DISCREPANCY`, `SHORT_SHIPMENT`).

### 3. Double-Entry Balance Sheet Invariants
Every settlement generates an immutable `JournalEntry` verifying that total debits equal total credits before committing to the ERP store:
* **Debit:** `CASH_CLEARING` (Amount received)
* **Debit:** `DISPUTED_ALLOWANCE` (Amount deducted by customer)
* **Credit:** `ACCOUNTS_RECEIVABLE` (Total invoice reduction)

---

## Verification & Testing

```bash
# Run the test suite
npm test
```

### Test Coverage Highlights
* `Multi-Invoice Lump-Sum Settlement`: Verifies clean closure of multi-invoice settlements.
* `Short-Pay Dispute Handling`: Verifies credit memo generation and balanced accounting under short-payment scenarios.
* `Strict Idempotency`: Proves duplicate payment submissions return cached states without altering ledger balances.
* `Level 3 Interchange Payload`: Verifies line-item extraction for Visa/Mastercard interchange minimization.
* `Amount Mismatch Rejection`: Ensures inconsistent remittance advice is rejected before touching the ledger.

---

Built by [Jayson Quindao](https://github.com/djjrip) — Founder & Full-Stack Engineer @ GG Loop. Open to engineering roles: [LinkedIn](https://linkedin.com/in/jaysonquindao) · jquindao1@icloud.com
