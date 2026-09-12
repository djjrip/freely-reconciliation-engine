export type CurrencyCents = number;

export type InvoiceStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'DISPUTED';

export type DisputeReason = 
  | 'DAMAGED_GOODS' 
  | 'PRICING_DISCREPANCY' 
  | 'SHORT_SHIPMENT' 
  | 'RETURNED_ITEMS'
  | 'UNSPECIFIED_DEDUCTION';

export interface LineItem {
  id: string;
  sku: string;
  description: string;
  quantity: number;
  unitPriceCents: CurrencyCents;
  totalCents: CurrencyCents;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  totalAmountCents: CurrencyCents;
  balanceCents: CurrencyCents;
  status: InvoiceStatus;
  lineItems: LineItem[];
}

export interface RemittanceClaim {
  invoiceNumber: string;
  amountAllocatedCents: CurrencyCents;
  disputeAmountCents?: CurrencyCents;
  disputeReason?: DisputeReason;
  disputeNotes?: string;
}

export interface PaymentSettlement {
  paymentId: string;
  customerId: string;
  amountCents: CurrencyCents;
  settlementRail: 'ACH' | 'CARD' | 'RTP_FEDNOW';
  paymentReference: string;
  claims: RemittanceClaim[];
  idempotencyKey: string;
}

export interface CreditMemo {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  amountCents: CurrencyCents;
  reason: DisputeReason;
  notes?: string;
  createdAt: string;
  status: 'PENDING_VENDOR_REVIEW' | 'APPLIED';
}

export interface JournalEntryLine {
  account: 'CASH_CLEARING' | 'ACCOUNTS_RECEIVABLE' | 'DISPUTED_ALLOWANCE' | 'INTERCHANGE_EXPENSE';
  debitCents: CurrencyCents;
  creditCents: CurrencyCents;
}

export interface JournalEntry {
  id: string;
  transactionId: string;
  idempotencyKey: string;
  timestamp: string;
  description: string;
  lines: JournalEntryLine[];
}

export interface ReconciliationResult {
  settlementId: string;
  idempotencyKey: string;
  status: 'PROCESSED_FULL' | 'PROCESSED_WITH_DISPUTES' | 'ALREADY_PROCESSED' | 'REJECTED_AMOUNT_MISMATCH';
  totalSettledCents: CurrencyCents;
  totalDisputedCents: CurrencyCents;
  affectedInvoices: {
    invoiceNumber: string;
    previousBalanceCents: CurrencyCents;
    newBalanceCents: CurrencyCents;
    status: InvoiceStatus;
  }[];
  creditMemos: CreditMemo[];
  journalEntry: JournalEntry;
}
