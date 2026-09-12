import { ERPStore } from './erpStore';
import { 
  PaymentSettlement, 
  ReconciliationResult, 
  CreditMemo, 
  JournalEntry, 
  InvoiceStatus,
  DisputeReason 
} from './types';

export class ReconciliationEngine {
  private erpStore: ERPStore;
  private processedIdempotencyKeys: Map<string, ReconciliationResult> = new Map();

  constructor(erpStore: ERPStore) {
    this.erpStore = erpStore;
  }

  /**
   * Processes an incoming payment settlement with strict idempotency and audit controls.
   * Matches remittances against open distributor invoices, handles short-pay deductions,
   * generates credit memos, and posts balanced double-entry journal records.
   */
  public async reconcileSettlement(settlement: PaymentSettlement): Promise<ReconciliationResult> {
    // 1. Strict Idempotency Check: Return cached record if already processed
    if (this.processedIdempotencyKeys.has(settlement.idempotencyKey)) {
      const cached = this.processedIdempotencyKeys.get(settlement.idempotencyKey)!;
      return {
        ...cached,
        status: 'ALREADY_PROCESSED'
      };
    }

    // 2. Validate payment math: Sum(amountAllocatedCents) must equal settlement.amountCents
    const totalAllocated = settlement.claims.reduce(
      (sum, claim) => sum + claim.amountAllocatedCents, 
      0
    );

    if (totalAllocated !== settlement.amountCents) {
      throw new Error(
        `Settlement rejected: Claim allocation sum (${totalAllocated}c) does not match settlement amount (${settlement.amountCents}c)`
      );
    }

    // 3. Pre-flight verification: Check all invoices exist and have sufficient open balance
    for (const claim of settlement.claims) {
      const invoice = this.erpStore.getInvoice(claim.invoiceNumber);
      if (!invoice) {
        throw new Error(`Reconciliation failed: Invoice ${claim.invoiceNumber} does not exist in ERP.`);
      }

      const claimTotalReduction = claim.amountAllocatedCents + (claim.disputeAmountCents || 0);
      if (claimTotalReduction > invoice.balanceCents) {
        throw new Error(
          `Reconciliation failed: Claim for ${claim.invoiceNumber} (${claimTotalReduction}c) exceeds open balance (${invoice.balanceCents}c).`
        );
      }
    }

    // 4. Execution phase: Apply cash, generate disputes, track state changes
    const affectedInvoices: {
      invoiceNumber: string;
      previousBalanceCents: number;
      newBalanceCents: number;
      status: InvoiceStatus;
    }[] = [];

    const creditMemos: CreditMemo[] = [];
    let totalDisputedCents = 0;

    for (const claim of settlement.claims) {
      const existing = this.erpStore.getInvoice(claim.invoiceNumber)!;
      const disputeAmount = claim.disputeAmountCents || 0;
      totalDisputedCents += disputeAmount;

      // Update invoice in ERP
      const updated = this.erpStore.updateInvoiceBalance(
        claim.invoiceNumber,
        claim.amountAllocatedCents,
        disputeAmount
      );

      affectedInvoices.push({
        invoiceNumber: claim.invoiceNumber,
        previousBalanceCents: existing.balanceCents,
        newBalanceCents: updated.balanceCents,
        status: updated.status
      });

      // If customer short-paid with a dispute, create formal Credit Memo
      if (disputeAmount > 0) {
        const memo: CreditMemo = {
          id: `cm_${Date.now()}_${claim.invoiceNumber}`,
          invoiceId: existing.id,
          invoiceNumber: claim.invoiceNumber,
          customerId: settlement.customerId,
          amountCents: disputeAmount,
          reason: claim.disputeReason || 'UNSPECIFIED_DEDUCTION',
          notes: claim.disputeNotes,
          createdAt: new Date().toISOString(),
          status: 'PENDING_VENDOR_REVIEW'
        };

        this.erpStore.postCreditMemo(memo);
        creditMemos.push(memo);
      }
    }

    // 5. Construct Double-Entry Journal Record:
    // Debit: CASH_CLEARING for settled payment amount
    // Debit: DISPUTED_ALLOWANCE for short-pay deductions
    // Credit: ACCOUNTS_RECEIVABLE for the full reduction (Cash + Disputes)
    const journalEntry: JournalEntry = {
      id: `je_${settlement.paymentId}`,
      transactionId: settlement.paymentId,
      idempotencyKey: settlement.idempotencyKey,
      timestamp: new Date().toISOString(),
      description: `Cash application for payment ref ${settlement.paymentReference} (${settlement.settlementRail})`,
      lines: [
        {
          account: 'CASH_CLEARING',
          debitCents: settlement.amountCents,
          creditCents: 0
        },
        ...(totalDisputedCents > 0 ? [{
          account: 'DISPUTED_ALLOWANCE' as const,
          debitCents: totalDisputedCents,
          creditCents: 0
        }] : []),
        {
          account: 'ACCOUNTS_RECEIVABLE',
          debitCents: 0,
          creditCents: settlement.amountCents + totalDisputedCents
        }
      ]
    };

    // Post to ERP Ledger
    this.erpStore.postJournalEntry(journalEntry);

    const result: ReconciliationResult = {
      settlementId: settlement.paymentId,
      idempotencyKey: settlement.idempotencyKey,
      status: totalDisputedCents > 0 ? 'PROCESSED_WITH_DISPUTES' : 'PROCESSED_FULL',
      totalSettledCents: settlement.amountCents,
      totalDisputedCents,
      affectedInvoices,
      creditMemos,
      journalEntry
    };

    // Cache idempotency result
    this.processedIdempotencyKeys.set(settlement.idempotencyKey, result);

    return result;
  }
}
