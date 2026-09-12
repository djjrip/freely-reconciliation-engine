import { Invoice, CreditMemo, JournalEntry, JournalEntryLine } from './types';

export class ERPStore {
  private invoices: Map<string, Invoice> = new Map();
  private creditMemos: Map<string, CreditMemo> = new Map();
  private journalEntries: JournalEntry[] = [];
  private ledgerBalances: Map<string, number> = new Map([
    ['CASH_CLEARING', 0],
    ['ACCOUNTS_RECEIVABLE', 0],
    ['DISPUTED_ALLOWANCE', 0],
    ['INTERCHANGE_EXPENSE', 0],
  ]);

  constructor(initialInvoices?: Invoice[]) {
    if (initialInvoices) {
      for (const inv of initialInvoices) {
        this.seedInvoice(inv);
      }
    }
  }

  public seedInvoice(inv: Invoice): void {
    this.invoices.set(inv.invoiceNumber, JSON.parse(JSON.stringify(inv)));
    // Seed initial AR balance
    const currentAR = this.ledgerBalances.get('ACCOUNTS_RECEIVABLE') || 0;
    this.ledgerBalances.set('ACCOUNTS_RECEIVABLE', currentAR + inv.balanceCents);
  }

  public getInvoice(invoiceNumber: string): Invoice | undefined {
    const inv = this.invoices.get(invoiceNumber);
    return inv ? JSON.parse(JSON.stringify(inv)) : undefined;
  }

  public getAllInvoices(): Invoice[] {
    return Array.from(this.invoices.values()).map(inv => JSON.parse(JSON.stringify(inv)));
  }

  public updateInvoiceBalance(
    invoiceNumber: string, 
    settledCents: number, 
    disputedCents: number
  ): Invoice {
    const inv = this.invoices.get(invoiceNumber);
    if (!inv) {
      throw new Error(`Invoice ${invoiceNumber} not found in ERP store.`);
    }

    const totalReduction = settledCents + disputedCents;
    if (totalReduction > inv.balanceCents) {
      throw new Error(
        `Over-application error: total reduction (${totalReduction}c) exceeds open balance (${inv.balanceCents}c)`
      );
    }

    inv.balanceCents -= totalReduction;
    if (inv.balanceCents === 0) {
      inv.status = disputedCents > 0 ? 'DISPUTED' : 'PAID';
    } else {
      inv.status = 'PARTIALLY_PAID';
    }

    this.invoices.set(invoiceNumber, inv);
    return JSON.parse(JSON.stringify(inv));
  }

  public postCreditMemo(memo: CreditMemo): void {
    this.creditMemos.set(memo.id, memo);
  }

  public getCreditMemos(): CreditMemo[] {
    return Array.from(this.creditMemos.values());
  }

  public postJournalEntry(entry: JournalEntry): void {
    // Verify double-entry balance: sum(debits) must equal sum(credits)
    let totalDebits = 0;
    let totalCredits = 0;

    for (const line of entry.lines) {
      totalDebits += line.debitCents;
      totalCredits += line.creditCents;
    }

    if (totalDebits !== totalCredits) {
      throw new Error(
        `Double-entry violation: Total debits (${totalDebits}c) do not equal total credits (${totalCredits}c)`
      );
    }

    // Apply to balance sheet
    for (const line of entry.lines) {
      const current = this.ledgerBalances.get(line.account) || 0;
      // Asset accounts: Debit increases, Credit decreases
      if (line.account === 'CASH_CLEARING') {
        this.ledgerBalances.set(line.account, current + line.debitCents - line.creditCents);
      } else if (line.account === 'ACCOUNTS_RECEIVABLE') {
        this.ledgerBalances.set(line.account, current - line.creditCents + line.debitCents);
      } else if (line.account === 'DISPUTED_ALLOWANCE') {
        this.ledgerBalances.set(line.account, current + line.debitCents - line.creditCents);
      } else if (line.account === 'INTERCHANGE_EXPENSE') {
        this.ledgerBalances.set(line.account, current + line.debitCents - line.creditCents);
      }
    }

    this.journalEntries.push(entry);
  }

  public getJournalEntries(): JournalEntry[] {
    return [...this.journalEntries];
  }

  public getLedgerBalance(account: 'CASH_CLEARING' | 'ACCOUNTS_RECEIVABLE' | 'DISPUTED_ALLOWANCE' | 'INTERCHANGE_EXPENSE'): number {
    return this.ledgerBalances.get(account) || 0;
  }
}
