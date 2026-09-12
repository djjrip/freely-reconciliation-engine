import { ERPStore } from './erpStore';
import { ReconciliationEngine } from './reconciliationEngine';
import { PaymentSettlement, ReconciliationResult } from './types';

export interface Level3InterchangePayload {
  merchantReference: string;
  customerCode: string;
  invoiceCount: number;
  dutyAmountCents: number;
  freightAmountCents: number;
  lineItems: {
    itemDescription: string;
    productCode: string;
    quantity: number;
    unitCostCents: number;
    totalAmountCents: number;
  }[];
}

export class CashApplicationSaga {
  private erpStore: ERPStore;
  private engine: ReconciliationEngine;

  constructor(erpStore: ERPStore) {
    this.erpStore = erpStore;
    this.engine = new ReconciliationEngine(erpStore);
  }

  /**
   * Generates Level 3 Card Data Payload from invoice line items to trigger
   * Visa/Mastercard commercial interchange fee reduction (e.g. from 2.9% down to 1.6%).
   */
  public generateLevel3InterchangePayload(settlement: PaymentSettlement): Level3InterchangePayload {
    const combinedLineItems = [];

    for (const claim of settlement.claims) {
      const invoice = this.erpStore.getInvoice(claim.invoiceNumber);
      if (invoice) {
        for (const item of invoice.lineItems) {
          combinedLineItems.push({
            itemDescription: item.description,
            productCode: item.sku,
            quantity: item.quantity,
            unitCostCents: item.unitPriceCents,
            totalAmountCents: item.totalCents
          });
        }
      }
    }

    return {
      merchantReference: settlement.paymentReference,
      customerCode: settlement.customerId,
      invoiceCount: settlement.claims.length,
      dutyAmountCents: 0,
      freightAmountCents: 0,
      lineItems: combinedLineItems
    };
  }

  /**
   * Executes the full end-to-end settlement saga:
   * 1. Inspects Level 3 eligibility.
   * 2. Reconciles payment against multi-invoice ERP ledger.
   * 3. Handles short-pay dispute deduction credit memos.
   */
  public async executeSettlementSaga(
    settlement: PaymentSettlement, 
    simulateNetworkCrashOnAttempt?: number,
    currentAttempt: number = 1
  ): Promise<{ result: ReconciliationResult; l3Payload?: Level3InterchangePayload }> {
    // Simulate network drop during ERP communication
    if (simulateNetworkCrashOnAttempt && currentAttempt === simulateNetworkCrashOnAttempt) {
      throw new Error(`[SAGA_SIMULATED_CRASH] Network dropped while communicating with ERP on attempt ${currentAttempt}`);
    }

    let l3Payload: Level3InterchangePayload | undefined;
    if (settlement.settlementRail === 'CARD') {
      l3Payload = this.generateLevel3InterchangePayload(settlement);
    }

    const result = await this.engine.reconcileSettlement(settlement);
    return { result, l3Payload };
  }
}
