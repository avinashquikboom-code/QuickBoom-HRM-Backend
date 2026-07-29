import { prisma } from './db';
import { getIntegrationSettings } from './configService';

let lastSalesSyncTime = 0;
const SALES_SYNC_COOLDOWN = 5 * 60 * 1000; // 5 minutes cooldown

/**
 * Fetches HopKid sales for a given date range across ALL employees
 * and upserts them into the local commissionTransaction table.
 */
export async function syncHopkidSales(options?: {
  fromDate?: Date;
  toDate?: Date;
  force?: boolean;
}): Promise<{ synced: number; skipped: number; errors: number }> {
  const now = Date.now();

  if (!options?.force && now - lastSalesSyncTime < SALES_SYNC_COOLDOWN) {
    console.log('🔄 [syncHopkidSales] Skipped: cooldown active.');
    return { synced: 0, skipped: 0, errors: 0 };
  }

  lastSalesSyncTime = now;

  const fromDate = options?.fromDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate = options?.toDate ?? new Date();

  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = toDate.toISOString().split('T')[0];

  console.log(`🔄 [syncHopkidSales] Syncing HopKid sales from ${fromStr} to ${toStr}...`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const { hopkidApiUrl, hopkidApiKey } = await getIntegrationSettings();

    // Derive sales URL from employee URL
    // e.g. https://hopkidapi.3dweb.in/api/Employee/GetEmployeeList → /api/Sales/GetSalesList
    const baseUrl = hopkidApiUrl.replace(/\/Employee\/.*$/i, '');
    const salesApiUrl = `${baseUrl}/Sales/GetSalesList`;

    const response = await fetch(salesApiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': hopkidApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        EmployeeCode: '',   // empty = all employees
        FromDate: fromStr,
        ToDate: toStr,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const msg = `HopKid Sales API returned HTTP ${response.status}. ${body}`.trim();
      console.error(`❌ [syncHopkidSales] ${msg}`);
      throw new Error(msg);
    }

    const result = (await response.json()) as any;

    if (!result.success) {
      const msg = `HopKid Sales API returned failure: ${result.message || 'Unknown error'}. The API key may not have Sales access — please update it in Admin Settings.`;
      console.error(`❌ [syncHopkidSales] ${msg}`);
      throw new Error(msg);
    }

    const salesList: any[] = result.data || [];
    console.log(`🔄 [syncHopkidSales] Got ${salesList.length} sales records from HopKid.`);

    for (const sale of salesList) {
      try {
        const employeeCode: string = sale.EmployeeCode || sale.employeeCode || '';
        const invoiceNumber: string = sale.InvoiceNo || sale.InvoiceNumber || sale.invoiceNumber || '';
        const billId: string = sale.SalesID ? String(sale.SalesID) : '';
        const rawSaleAmount = sale.NetAmount ?? sale.FinalAmount ?? sale.saleAmount ?? 0;
        const saleAmount = parseFloat(rawSaleAmount);
        const saleDate = sale.SalesDate
          ? new Date(sale.SalesDate)
          : sale.salesDate
          ? new Date(sale.salesDate)
          : new Date();

        if (!employeeCode || isNaN(saleAmount)) {
          skipped++;
          continue;
        }

        const employee = await prisma.employee.findUnique({
          where: { employeeCode },
          include: {
            commissionPolicies: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            },
          },
        });

        if (!employee) {
          console.warn(`⚠️ [syncHopkidSales] No local employee for code ${employeeCode} — skipping ${invoiceNumber}`);
          skipped++;
          continue;
        }

        // Idempotent: skip if already imported
        const orConditions: any[] = [];
        if (invoiceNumber) orConditions.push({ invoiceNumber });
        if (billId) orConditions.push({ billId });

        if (orConditions.length > 0) {
          const existing = await prisma.commissionTransaction.findFirst({
            where: { employeeId: employee.id, OR: orConditions },
          });
          if (existing) {
            skipped++;
            continue;
          }
        }

        // Commission calculation
        let policy = employee.commissionPolicies[0];
        const targetStoreId = employee.storeId;

        if (!policy && targetStoreId) {
          const store = await prisma.store.findUnique({
            where: { id: targetStoreId },
            include: {
              commissionPolicies: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
              },
            },
          });
          if (store && store.commissionPolicies.length > 0) {
            policy = store.commissionPolicies[0];
          }
        }

        let commissionAmount = 0;
        let commissionPercent = 0;
        let commissionType = 'PERCENTAGE';

        if (policy) {
          commissionType = policy.commissionType;
          if (policy.commissionType === 'PERCENTAGE') {
            commissionAmount = (saleAmount * policy.commissionValue) / 100;
            commissionPercent = policy.commissionValue;
          } else if (policy.commissionType === 'FIXED') {
            commissionAmount = policy.commissionValue;
          }
        } else if (employee.commissionPercentage !== null && employee.commissionPercentage !== undefined) {
          commissionType = 'PERCENTAGE';
          commissionPercent = employee.commissionPercentage;
          commissionAmount = (saleAmount * employee.commissionPercentage) / 100;
        }

        await prisma.commissionTransaction.create({
          data: {
            employeeId: employee.id,
            storeId: targetStoreId,
            policyId: policy ? policy.id : null,
            saleAmount,
            commissionType,
            commissionPercent: commissionPercent || null,
            commissionAmount,
            billId: billId || null,
            invoiceNumber: invoiceNumber || null,
            status: 'PENDING',
            createdAt: saleDate,
            notes: `Auto-synced from HopKid on ${new Date().toISOString()}`,
          },
        });

        synced++;
      } catch (rowErr) {
        console.error(`❌ [syncHopkidSales] Error processing sale:`, rowErr);
        errors++;
      }
    }

    console.log(`✅ [syncHopkidSales] Done. synced=${synced}, skipped=${skipped}, errors=${errors}`);
    return { synced, skipped, errors };
  } catch (error) {
    console.error('❌ [syncHopkidSales] Fatal error:', error);
    return { synced, skipped, errors: errors + 1 };
  }
}
