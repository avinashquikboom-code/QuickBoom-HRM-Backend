import { prisma } from './db';

let lastSyncTime = 0;
const SYNC_COOLDOWN = 10 * 1000; // 10 seconds cooldown to prevent spamming the external API

export async function syncHopkidEmployees(): Promise<void> {
  const now = Date.now();
  if (now - lastSyncTime < SYNC_COOLDOWN) {
    console.log('🔄 [syncHopkidEmployees] Skipped sync: rate limit cooldown active.');
    return;
  }
  
  lastSyncTime = now;
  console.log('🔄 [syncHopkidEmployees] Starting employee synchronization from external API...');
  
  try {
    const response = await fetch('https://hopkidapi.3dweb.in/api/Employee/GetEmployeeList', {
      method: 'GET',
      headers: {
        'x-api-key': 'HOPKID-MOBILE-ACCESS-API-KEY',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`❌ [syncHopkidEmployees] External API responded with status ${response.status}`);
      return;
    }

    const result = (await response.json()) as any;
    const dataList = result.data || [];

    console.log(`🔄 [syncHopkidEmployees] Fetched ${dataList.length} employees. Syncing to local DB...`);

    let syncCount = 0;

    for (const emp of dataList) {
      if (!emp.employeeCode) continue;

      let localStoreId: number | null = null;

      if (emp.branchName) {
        // Find or create Store
        let store = await prisma.store.findFirst({
          where: { name: emp.branchName }
        });
        if (!store) {
          store = await prisma.store.create({
            data: {
              name: emp.branchName,
              code: emp.branchName.substring(0, 10),
            }
          });
        }
        localStoreId = store.id;
      }

      const firstName = emp.employeeName ? emp.employeeName.split(' ')[0] : 'Employee';
      const lastName = emp.employeeName ? emp.employeeName.split(' ').slice(1).join(' ') : '';
      const mobileNumber = emp.mobileNo || '';
      const joiningDate = emp.dateofJoining ? new Date(emp.dateofJoining) : null;
      const status = emp.isActive ? 'active' : 'inactive';
      const commissionPercentage = emp.commissionPercentage || 1.00;

      // Upsert the Employee by employeeCode
      await prisma.employee.upsert({
        where: { employeeCode: emp.employeeCode },
        update: {
          firstName,
          lastName,
          mobileNumber,
          joiningDate,
          status,
          commissionPercentage,
          storeId: localStoreId,
        },
        create: {
          employeeCode: emp.employeeCode,
          firstName,
          lastName,
          mobileNumber,
          joiningDate,
          status,
          commissionPercentage,
          storeId: localStoreId,
        }
      });
      syncCount++;
    }
    console.log(`✅ [syncHopkidEmployees] Sync completed successfully! Synchronized ${syncCount} employees.`);
  } catch (error) {
    console.error('❌ [syncHopkidEmployees] Error during employee synchronization:', error);
  }
}
