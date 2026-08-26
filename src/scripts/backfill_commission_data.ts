
import { getNumericInvoiceNumber, extractWebhookMeta } from '../utils/commissionHelper';
import { prisma } from '../utils/db';

export async function backfillCommissionData() {
  console.log('🔄 [BACKFILL] Starting Commission & Bill ID Data Backfill...');

  try {
    // 1. Backfill CommissionTransaction records
    const transactions = await prisma.commissionTransaction.findMany({
      include: {
        employee: true,
      },
    });

    console.log(`🔍 [BACKFILL] Inspecting ${transactions.length} CommissionTransaction records...`);

    let txUpdated = 0;
    for (const tx of transactions) {
      let needsUpdate = false;
      const dataToUpdate: any = {};

      const numInv = getNumericInvoiceNumber(tx);
      const strBillId = String(tx.billId || '').trim();
      const strInvNo = String(tx.invoiceNumber || '').trim();
      const isBillIdUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(strBillId);
      const isInvNoUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(strInvNo);

      // Fix Bill ID if it was UUID
      if (isBillIdUuid || !strBillId) {
        dataToUpdate.billId = String(numInv);
        needsUpdate = true;
      }

      // Fix Invoice Number if it was UUID or missing
      if (isInvNoUuid || !strInvNo) {
        dataToUpdate.invoiceNumber = `HWM-${numInv}`;
        needsUpdate = true;
      }

      // Fix Commission Rate
      const rate = tx.commissionPercent !== null && tx.commissionPercent !== undefined && tx.commissionPercent > 0
        ? Number(tx.commissionPercent)
        : (tx.employee?.commissionPercentage !== null && tx.employee?.commissionPercentage !== undefined && tx.employee.commissionPercentage > 0
          ? Number(tx.employee.commissionPercentage)
          : 1);

      if (tx.commissionPercent === null || tx.commissionPercent === undefined || tx.commissionPercent === 0) {
        dataToUpdate.commissionPercent = rate;
        needsUpdate = true;
      }

      // Fix Commission Amount if ₹0 with valid sale
      const isUpdate = tx.eventType === 'INVOICE_UPDATED' || (tx.oldAmount !== null && tx.oldAmount !== undefined && Number(tx.oldAmount) > 0);
      const oldAmt = Number(tx.oldAmount || 0);
      const newAmt = Number(tx.newAmount || tx.saleAmount || 0);

      let correctOldComm = tx.oldCommission !== null && tx.oldCommission !== undefined && Number(tx.oldCommission) > 0
        ? Number(tx.oldCommission)
        : (oldAmt > 0 ? Math.round(((oldAmt * rate) / 100) * 100) / 100 : 0);

      let correctNewComm = tx.newCommission !== null && tx.newCommission !== undefined && Number(tx.newCommission) > 0
        ? Number(tx.newCommission)
        : Math.round(((newAmt * rate) / 100) * 100) / 100;

      let expectedCommAmount = 0;
      if (isUpdate && oldAmt > 0) {
        expectedCommAmount = Math.round((correctOldComm + correctNewComm) * 100) / 100;
      } else {
        expectedCommAmount = Math.round(((newAmt * rate) / 100) * 100) / 100;
      }

      if (isUpdate) {
        if (tx.oldCommission === null || tx.oldCommission === undefined || Number(tx.oldCommission) === 0) {
          dataToUpdate.oldCommission = correctOldComm;
          needsUpdate = true;
        }
        if (tx.newCommission === null || tx.newCommission === undefined || Number(tx.newCommission) === 0) {
          dataToUpdate.newCommission = correctNewComm;
          needsUpdate = true;
        }
      }

      if ((tx.commissionAmount === null || tx.commissionAmount === undefined || Number(tx.commissionAmount) === 0) && expectedCommAmount > 0) {
        dataToUpdate.commissionAmount = expectedCommAmount;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await prisma.commissionTransaction.update({
          where: { id: tx.id },
          data: dataToUpdate,
        });
        txUpdated++;
      }
    }

    console.log(`✅ [BACKFILL] CommissionTransaction: updated ${txUpdated} records.`);

    // 2. Backfill WebhookLog records
    const webhookLogs = await prisma.webhookLog.findMany();
    let whUpdated = 0;
    for (const log of webhookLogs) {
      const meta = extractWebhookMeta(log.payload);
      const numInv = getNumericInvoiceNumber({ invoiceNumber: meta.invoiceNumber, billId: log.billId || meta.billId, id: log.id });
      const strBillId = String(log.billId || '').trim();
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(strBillId);

      if (isUuid || !strBillId) {
        await prisma.webhookLog.update({
          where: { id: log.id },
          data: {
            billId: String(numInv),
          },
        });
        whUpdated++;
      }
    }

    console.log(`✅ [BACKFILL] WebhookLog: updated ${whUpdated} records.`);
    console.log('🎉 [BACKFILL] Commission and Bill ID backfill completed successfully.');
  } catch (error: any) {
    console.error('❌ [BACKFILL] Error during backfill:', error.message);
  }
}

if (require.main === module) {
  backfillCommissionData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
