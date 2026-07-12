import { prisma } from './db';

let lastSyncTime = 0;
const SYNC_COOLDOWN = 10 * 1000; // 10 seconds cooldown to prevent spamming the external API

export async function syncStoresAndOffices(): Promise<void> {
  try {
    console.log('🔄 [syncStoresAndOffices] Mirroring Stores to Offices...');
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      // Find matching office by code or name
      let office = await prisma.office.findFirst({
        where: {
          OR: [
            { code: store.code || undefined },
            { name: store.name }
          ]
        }
      });

      if (!office) {
        // Create matching office
        office = await prisma.office.create({
          data: {
            name: store.name,
            code: store.code,
            address: store.address || '',
            latitude: store.latitude || 0.0,
            longitude: store.longitude || 0.0,
            maxPunchRadiusMeters: store.maxPunchRadiusMeters || 50.0,
          }
        });
        console.log(`✅ [syncStoresAndOffices] Created matching Office for Store "${store.name}"`);
      } else {
        // Update matching office with store values
        office = await prisma.office.update({
          where: { id: office.id },
          data: {
            name: store.name,
            code: store.code,
            address: store.address || '',
            latitude: store.latitude || 0.0,
            longitude: store.longitude || 0.0,
            maxPunchRadiusMeters: store.maxPunchRadiusMeters || 50.0,
          }
        });
        console.log(`✅ [syncStoresAndOffices] Updated matching Office coordinates/radius for Store "${store.name}" to Lat: ${store.latitude}, Lng: ${store.longitude}, Radius: ${store.maxPunchRadiusMeters}m`);
      }
    }

    // Now update all employees who have a storeId assigned to have the correct matching officeId
    const employeesWithStore = await prisma.employee.findMany({
      where: { storeId: { not: null } },
      include: { store: true }
    });

    for (const emp of employeesWithStore) {
      if (emp.store) {
        const matchingOffice = await prisma.office.findFirst({
          where: {
            OR: [
              { code: emp.store.code || undefined },
              { name: emp.store.name }
            ]
          }
        });
        if (matchingOffice && emp.officeId !== matchingOffice.id) {
          await prisma.employee.update({
            where: { id: emp.id },
            data: { officeId: matchingOffice.id }
          });
          console.log(`✅ [syncStoresAndOffices] Synced employee "${emp.firstName} ${emp.lastName}" officeId to "${matchingOffice.name}"`);
        }
      }
    }
  } catch (error) {
    console.error('❌ [syncStoresAndOffices] Error syncing stores and offices:', error);
  }
}

export async function syncHopkidEmployees(): Promise<void> {
  // First ensure stores and offices tables are synced
  await syncStoresAndOffices();

  const now = Date.now();
  if (now - lastSyncTime < SYNC_COOLDOWN) {
    console.log('🔄 [syncHopkidEmployees] Skipped external employee sync: rate limit cooldown active.');
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
      let localOfficeId: number | null = null;

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

        // Find or create matching Office
        let office = await prisma.office.findFirst({
          where: { name: emp.branchName }
        });
        if (!office) {
          office = await prisma.office.create({
            data: {
              name: emp.branchName,
              code: emp.branchName.substring(0, 10),
              address: store.address || '',
              latitude: store.latitude || 0.0,
              longitude: store.longitude || 0.0,
              maxPunchRadiusMeters: store.maxPunchRadiusMeters || 50.0,
            }
          });
        }
        localOfficeId = office.id;
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
          officeId: localOfficeId,
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
          officeId: localOfficeId,
        }
      });
      syncCount++;
    }
    console.log(`✅ [syncHopkidEmployees] Sync completed successfully! Synchronized ${syncCount} employees.`);
  } catch (error) {
    console.error('❌ [syncHopkidEmployees] Error during employee synchronization:', error);
  }
}
