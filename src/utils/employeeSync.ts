import { defaultPOSCredential } from '../pos/storeCredentials';
import { prisma } from './db';
import { getIntegrationSettings } from './configService';
import userSessionService from '../services/userSessionService';

let lastSyncTime = 0;
const SYNC_COOLDOWN = 10 * 1000; // 10 seconds cooldown to prevent spamming the external API

export interface HopkidEmployeeSyncResult {
  success: boolean;
  fetchedCount: number;
  syncedCount: number;
  skippedCount: number;
  invalidCount: number;
  message: string;
}

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

export async function syncHopkidEmployees(): Promise<HopkidEmployeeSyncResult> {
  const now = Date.now();
  if (now - lastSyncTime < SYNC_COOLDOWN) {
    return { success: false, fetchedCount: 0, syncedCount: 0, skippedCount: 0, invalidCount: 0, message: 'An employee sync was just attempted. Wait a few seconds and retry.' };
  }
  
  lastSyncTime = now;
  console.log('🔄 [syncHopkidEmployees] Starting employee synchronization from external API...');
  
  try {
    const { hopkidApiUrl, hopkidApiKey } = await getIntegrationSettings();
    if (!hopkidApiUrl?.trim()) throw new Error('HopKid employee endpoint is not configured.');
    if (!hopkidApiKey?.trim()) throw new Error('HopKid API key is not configured on the backend. Set HOPKID_API_KEY or restore saved integration settings.');
    const endpoint = new URL(hopkidApiUrl);
    if (endpoint.protocol !== 'https:') throw new Error('HopKid employee endpoint must use HTTPS.');
    const response = await fetch(hopkidApiUrl, {
      method: 'GET',
      headers: {
        'x-api-key': hopkidApiKey.trim(),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HopKid employee endpoint returned HTTP ${response.status}. Check the backend credential and provider access.`);
    }

    const result = (await response.json()) as any;
    const dataList = result?.data;
    if (!Array.isArray(dataList)) {
      throw new Error('HopKid employee endpoint returned an unsupported response: expected a data array. No records were imported.');
    }

    console.info('[syncHopkidEmployees] Provider response received', { status: response.status, fetchedCount: dataList.length });
    await syncStoresAndOffices();

    let syncCount = 0;
    let skippedCount = 0;
    let invalidCount = 0;

    for (const [index, emp] of dataList.entries()) {
      if (!emp || typeof emp !== 'object' || !String(emp.employeeCode ?? '').trim() || !String(emp.employeeName ?? '').trim() || typeof emp.isActive !== 'boolean') {
        invalidCount++;
        console.error('[syncHopkidEmployees] Rejected invalid provider record', { recordIndex: index, missingEmployeeCode: !String(emp?.employeeCode ?? '').trim(), missingEmployeeName: !String(emp?.employeeName ?? '').trim(), invalidEmploymentStatus: typeof emp?.isActive !== 'boolean' });
        continue;
      }

      let localStoreId: number | null = null;
      let localOfficeId: number | null = null;

      if (emp.branchName) {
        // Find or create Store
        let store = await prisma.store.findFirst({
          where: { name: emp.branchName }
        });
        if (!store) {
          const baseCode = emp.branchName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
          const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
          const storeCode = `${baseCode.substring(0, 8)}_${randomSuffix}`;
          store = await prisma.store.create({
            data: {
              name: emp.branchName,
              code: storeCode,
              posCredential: { create: await defaultPOSCredential() },
            }
          });
        }
        localStoreId = store.id;

        // Find or create matching Office
        let office = await prisma.office.findFirst({
          where: { name: emp.branchName }
        });
        if (!office) {
          const baseCode = emp.branchName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
          const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
          const officeCode = `${baseCode.substring(0, 8)}_${randomSuffix}`;
          office = await prisma.office.create({
            data: {
              name: emp.branchName,
              code: officeCode,
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
      if (joiningDate && isNaN(joiningDate.getTime())) {
        invalidCount++;
        console.error('[syncHopkidEmployees] Rejected provider record with invalid joining date', { recordIndex: index });
        continue;
      }
      const status = emp.isActive ? 'active' : 'inactive';
      const commissionPercentage = (emp.commissionPercentage !== undefined && emp.commissionPercentage !== null && !isNaN(Number(emp.commissionPercentage)))
        ? Number(emp.commissionPercentage)
        : null;
      const employeeID = emp.employeeID ? String(emp.employeeID).toLowerCase() : null;

      // Upsert the Employee by employeeCode
      // Check if employee already exists locally
      const existingEmployee = await prisma.employee.findFirst({
        where: {
          OR: [
            ...(employeeID ? [{ employeeID: { equals: employeeID, mode: 'insensitive' as const } }] : []),
            { employeeCode: { equals: String(emp.employeeCode).trim(), mode: 'insensitive' as const } },
          ],
        },
      });

      if (existingEmployee) {
        if (existingEmployee.source === 'MANUAL') {
          console.log(`⚠️ [syncHopkidEmployees] Skipped manual employee: Code ${emp.employeeCode} (${existingEmployee.firstName} ${existingEmployee.lastName})`);
          skippedCount++;
          continue;
        }

        // Update existing HopKid employee
        await prisma.employee.update({
          where: { id: existingEmployee.id },
          data: {
            ...(employeeID ? { employeeID } : {}),
            employeeCode: String(emp.employeeCode).trim(),
            firstName,
            lastName,
            ...(mobileNumber ? { mobileNumber } : {}),
            ...(joiningDate ? { joiningDate } : {}),
            ...(typeof emp.designation === 'string' && emp.designation.trim() ? { designation: emp.designation.trim() } : {}),
            status,
            ...(emp.commissionPercentage !== undefined && emp.commissionPercentage !== null && !isNaN(Number(emp.commissionPercentage)) ? { commissionPercentage } : {}),
            ...(emp.branchName ? { storeId: localStoreId, officeId: localOfficeId } : {}),
            source: 'HOPKID',
          },
        });

        if (existingEmployee.userId) {
          const isStatusActive = status === 'active';
          await prisma.user.update({
            where: { id: existingEmployee.userId },
            data: { isActive: isStatusActive },
          });
          if (!isStatusActive) {
            await userSessionService.revokeAllSessions(existingEmployee.userId);
          }
        }
      } else {
        // Create new HopKid employee
        await prisma.employee.create({
          data: {
            employeeID,
            employeeCode: String(emp.employeeCode).trim(),
            firstName,
            lastName,
            mobileNumber: mobileNumber || null,
            joiningDate,
            designation: typeof emp.designation === 'string' && emp.designation.trim() ? emp.designation.trim() : null,
            status,
            commissionPercentage: emp.commissionPercentage !== undefined && emp.commissionPercentage !== null && !isNaN(Number(emp.commissionPercentage)) ? commissionPercentage : null,
            storeId: emp.branchName ? localStoreId : null,
            officeId: emp.branchName ? localOfficeId : null,
            source: 'HOPKID',
          },
        });
      }
      syncCount++;
    }
    const summary: HopkidEmployeeSyncResult = {
      success: invalidCount === 0,
      fetchedCount: dataList.length,
      syncedCount: syncCount,
      skippedCount,
      invalidCount,
      message: invalidCount ? `Synced ${syncCount} of ${dataList.length} records; ${invalidCount} invalid records need provider correction.` : `Synced ${syncCount} employee records; ${skippedCount} manual records were preserved.`,
    };
    console.info('[syncHopkidEmployees] Sync completed', summary);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown employee synchronization error';
    console.error('[syncHopkidEmployees] Sync failed', { message });
    throw error instanceof Error ? error : new Error(message);
  }
}

/**
 * Pushes employee updates from HRM Admin Panel to external HopKid ERP API
 */
export async function pushEmployeeToHopkidERP(employeeData: {
  employeeID?: string | null;
  employeeCode?: string | null;
  firstName?: string;
  lastName?: string;
  mobileNumber?: string | null;
  designation?: string | null;
  commissionPercentage?: number | null;
  basicSalary?: number | null;
  storeName?: string | null;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const { hopkidApiUrl, hopkidApiKey } = await getIntegrationSettings();
    const baseUrl = hopkidApiUrl.replace(/\/Employee\/.*$/i, '');
    const endpoints = [
      `${baseUrl}/Employee/UpdateEmployee`,
      `${baseUrl}/Employee/SaveEmployee`,
      `${baseUrl}/Employee/EditEmployee`
    ];

    const payload = {
      EmployeeID: employeeData.employeeID || undefined,
      EmployeeCode: employeeData.employeeCode || undefined,
      FirstName: employeeData.firstName,
      LastName: employeeData.lastName,
      Name: `${employeeData.firstName || ''} ${employeeData.lastName || ''}`.trim(),
      MobileNo: employeeData.mobileNumber,
      Designation: employeeData.designation,
      CommissionRate: employeeData.commissionPercentage ?? 0,
      BasicSalary: employeeData.basicSalary ?? 0,
      BranchName: employeeData.storeName
    };

    console.log(`[HopKid ERP Push] Pushing employee update to HopKid ERP for Code: ${employeeData.employeeCode || employeeData.employeeID}...`);

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'x-api-key': hopkidApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          console.log(`[HopKid ERP Push] ✅ Successfully pushed update for ${employeeData.employeeCode || employeeData.employeeID} via ${endpoint}`);
          return { success: true };
        }
      } catch (attemptErr: any) {
        console.warn(`[HopKid ERP Push] Attempt failed for ${endpoint}:`, attemptErr.message);
      }
    }
  } catch (err: any) {
    console.error('[HopKid ERP Push] ❌ Error pushing employee update to HopKid ERP:', err.message);
  }
  return { success: false, message: 'HopKid ERP update endpoint notice' };
}
