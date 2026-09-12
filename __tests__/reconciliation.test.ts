import { ERPStore } from '../src/erpStore';
import { ReconciliationEngine } from '../src/reconciliationEngine';
import { CashApplicationSaga } from '../src/sagaWorkflow';
import { Invoice, PaymentSettlement } from '../src/types';

describe('Freely B2B Reconciliation & Cash Application Engine', () => {
  let erpStore: ERPStore;
  let engine: ReconciliationEngine;
  let saga: CashApplicationSaga;

  const mockInvoices: Invoice[] = [
    {
      id: 'inv_001',
      invoiceNumber: 'INV-2026-001',
      customerId: 'cust_dallas_bistro_44',
      customerName: 'Dallas Prime Bistro',
      totalAmountCents: 200000, // $2,000.00
      balanceCents: 200000,
      status: 'OPEN',
      lineItems: [
        {
          id: 'li_1',
          sku: 'USDA-RIBEYE-10OZ',
          description: 'USDA Prime Ribeye 10oz (Case of 24)',
          quantity: 2,
          unitPriceCents: 100000,
          totalCents: 200000
        }
      ]
    },
    {
      id: 'inv_002',
      invoiceNumber: 'INV-2026-002',
      customerId: 'cust_dallas_bistro_44',
      customerName: 'Dallas Prime Bistro',
      totalAmountCents: 150000, // $1,500.00
      balanceCents: 150000,
      status: 'OPEN',
      lineItems: [
        {
          id: 'li_2',
          sku: 'ORGANIC-HEIRLOOM-TOMATO',
          description: 'Organic Heirloom Tomatoes (25lb Flat)',
          quantity: 15,
          unitPriceCents: 10000,
          totalCents: 150000
        }
      ]
    },
    {
      id: 'inv_003',
      invoiceNumber: 'INV-2026-003',
      customerId: 'cust_dallas_bistro_44',
      customerName: 'Dallas Prime Bistro',
      totalAmountCents: 500000, // $5,000.00
      balanceCents: 500000,
      status: 'OPEN',
      lineItems: [
        {
          id: 'li_3',
          sku: 'FRESH-ATLANTIC-SALMON',
          description: 'Fresh Atlantic Salmon Fillets (50lb crate)',
          quantity: 5,
          unitPriceCents: 100000,
          totalCents: 500000
        }
      ]
    }
  ];

  beforeEach(() => {
    erpStore = new ERPStore(mockInvoices);
    engine = new ReconciliationEngine(erpStore);
    saga = new CashApplicationSaga(erpStore);
  });

  test('Multi-Invoice Lump-Sum Settlement (Exact Match)', async () => {
    // Restaurant sends $3,500 lump sum covering INV-001 ($2,000) and INV-002 ($1,500)
    const settlement: PaymentSettlement = {
      paymentId: 'pay_lump_sum_8819',
      customerId: 'cust_dallas_bistro_44',
      amountCents: 350000,
      settlementRail: 'ACH',
      paymentReference: 'ACH-TRACE-998201',
      idempotencyKey: 'idemp_lump_sum_8819',
      claims: [
        { invoiceNumber: 'INV-2026-001', amountAllocatedCents: 200000 },
        { invoiceNumber: 'INV-2026-002', amountAllocatedCents: 150000 }
      ]
    };

    const result = await engine.reconcileSettlement(settlement);

    expect(result.status).toBe('PROCESSED_FULL');
    expect(result.totalSettledCents).toBe(350000);
    expect(result.totalDisputedCents).toBe(0);

    // Verify Invoices marked PAID with zero balance
    const inv1 = erpStore.getInvoice('INV-2026-001')!;
    const inv2 = erpStore.getInvoice('INV-2026-002')!;
    expect(inv1.balanceCents).toBe(0);
    expect(inv1.status).toBe('PAID');
    expect(inv2.balanceCents).toBe(0);
    expect(inv2.status).toBe('PAID');

    // Verify Double-Entry Balance Sheet
    expect(erpStore.getLedgerBalance('CASH_CLEARING')).toBe(350000);
    // Initial AR was $8,500 ($850,000c). Reduced by $3,500 -> $5,000 ($500,000c)
    expect(erpStore.getLedgerBalance('ACCOUNTS_RECEIVABLE')).toBe(500000);
  });

  test('Short-Pay Dispute Handling with Automatic Credit Memo', async () => {
    // Restaurant pays $4,500 on a $5,000 salmon invoice, deducting $500 for damaged fish
    const settlement: PaymentSettlement = {
      paymentId: 'pay_short_5521',
      customerId: 'cust_dallas_bistro_44',
      amountCents: 450000,
      settlementRail: 'CARD',
      paymentReference: 'TXN-CARD-44102',
      idempotencyKey: 'idemp_short_5521',
      claims: [
        {
          invoiceNumber: 'INV-2026-003',
          amountAllocatedCents: 450000,
          disputeAmountCents: 50000,
          disputeReason: 'DAMAGED_GOODS',
          disputeNotes: '1 case arrived bruised and warm (temp log: 48F)'
        }
      ]
    };

    const result = await engine.reconcileSettlement(settlement);

    expect(result.status).toBe('PROCESSED_WITH_DISPUTES');
    expect(result.totalSettledCents).toBe(450000);
    expect(result.totalDisputedCents).toBe(50000);

    // Invoice should be closed out as DISPUTED
    const inv3 = erpStore.getInvoice('INV-2026-003')!;
    expect(inv3.balanceCents).toBe(0);
    expect(inv3.status).toBe('DISPUTED');

    // Credit memo verified
    expect(result.creditMemos.length).toBe(1);
    expect(result.creditMemos[0].amountCents).toBe(50000);
    expect(result.creditMemos[0].reason).toBe('DAMAGED_GOODS');
    expect(result.creditMemos[0].status).toBe('PENDING_VENDOR_REVIEW');

    // Ledger accounting: Cash +$4,500, Disputed Allowance +$500, AR reduced -$5,000
    expect(erpStore.getLedgerBalance('CASH_CLEARING')).toBe(450000);
    expect(erpStore.getLedgerBalance('DISPUTED_ALLOWANCE')).toBe(50000);
  });

  test('Strict Idempotency: Duplicate payment submission does not double-apply cash', async () => {
    const settlement: PaymentSettlement = {
      paymentId: 'pay_idemp_test_1',
      customerId: 'cust_dallas_bistro_44',
      amountCents: 200000,
      settlementRail: 'ACH',
      paymentReference: 'REF-IDEMP-01',
      idempotencyKey: 'key_strictly_unique_101',
      claims: [
        { invoiceNumber: 'INV-2026-001', amountAllocatedCents: 200000 }
      ]
    };

    // First attempt
    const firstAttempt = await engine.reconcileSettlement(settlement);
    expect(firstAttempt.status).toBe('PROCESSED_FULL');
    expect(erpStore.getLedgerBalance('CASH_CLEARING')).toBe(200000);

    // Second attempt (simulating duplicate webhook / network retry)
    const secondAttempt = await engine.reconcileSettlement(settlement);
    expect(secondAttempt.status).toBe('ALREADY_PROCESSED');
    
    // Ledger balance MUST remain unchanged
    expect(erpStore.getLedgerBalance('CASH_CLEARING')).toBe(200000);
    expect(erpStore.getJournalEntries().length).toBe(1);
  });

  test('Level 3 Interchange Payload generation for Card transactions', async () => {
    const settlement: PaymentSettlement = {
      paymentId: 'pay_card_l3_test',
      customerId: 'cust_dallas_bistro_44',
      amountCents: 200000,
      settlementRail: 'CARD',
      paymentReference: 'CARD-AUTH-99128',
      idempotencyKey: 'key_l3_99128',
      claims: [
        { invoiceNumber: 'INV-2026-001', amountAllocatedCents: 200000 }
      ]
    };

    const { result, l3Payload } = await saga.executeSettlementSaga(settlement);

    expect(result.status).toBe('PROCESSED_FULL');
    expect(l3Payload).toBeDefined();
    expect(l3Payload!.customerCode).toBe('cust_dallas_bistro_44');
    expect(l3Payload!.lineItems.length).toBe(1);
    expect(l3Payload!.lineItems[0].productCode).toBe('USDA-RIBEYE-10OZ');
    expect(l3Payload!.lineItems[0].totalAmountCents).toBe(200000);
  });

  test('Rejects settlement if claim sum does not match settlement amount', async () => {
    const invalidSettlement: PaymentSettlement = {
      paymentId: 'pay_mismatch',
      customerId: 'cust_dallas_bistro_44',
      amountCents: 500000, // Stated $5,000
      settlementRail: 'ACH',
      paymentReference: 'REF-BAD-SUM',
      idempotencyKey: 'key_bad_sum',
      claims: [
        { invoiceNumber: 'INV-2026-001', amountAllocatedCents: 200000 } // Only allocated $2,000
      ]
    };

    await expect(engine.reconcileSettlement(invalidSettlement)).rejects.toThrow(
      /Claim allocation sum .* does not match settlement amount/
    );
  });
});
