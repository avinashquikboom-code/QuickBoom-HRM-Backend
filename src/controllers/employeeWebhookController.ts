import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog } from '../utils/commissionHelper';

const router = Router();

console.log('[Employee Webhook Controller] ✅ Loaded');

/**
 * Helper to safely extract candidate employee code / GUID / identifier from raw webhook payload
 */
export function extractEmployeeIdentifier(payload: any): string | null {
  if (!payload) return null;
  const data = payload.data || payload;
  const employee = data.employee || payload.employee || data;

  const id =
    employee.employeeCode ||
    employee.code ||
    employee.empCode ||
    employee.employeeID ||
    employee.employeeId ||
    employee.id ||
    data.employeeCode ||
    data.code ||
    data.empCode ||
    data.employeeID ||
    data.employeeId ||
    data.id ||
    payload.employeeCode ||
    payload.code ||
    payload.empCode ||
    payload.employeeID ||
    payload.employeeId ||
    payload.id;

  return id ? String(id).trim() : null;
}

/**
 * Robust Store & Office resolver supporting all HopKid store payload variations
 */
export async function resolveStoreAndOffice(employeeData: any): Promise<{ storeId: number | null; officeId: number | null }> {
  if (!employeeData) return { storeId: null, officeId: null };

  const storeObj = employeeData.assignedStore || employeeData.store || employeeData.branch || employeeData.outlet;

  let rawStoreId: any = employeeData.assignedStoreId || employeeData.assigned_store_id || 
                        employeeData.storeId || employeeData.storeID || employeeData.store_id || 
                        employeeData.branchId || employeeData.branch_id || employeeData.outletId ||
                        (typeof storeObj === 'object' && storeObj !== null ? (storeObj.id || storeObj.storeId || storeObj.code) : null);

  let rawStoreName: any = employeeData.branchName || employeeData.storeName || employeeData.assignedStoreName ||
                          (typeof storeObj === 'string' ? storeObj : (typeof storeObj === 'object' && storeObj !== null ? storeObj.name : null)) ||
                          employeeData.branch || employeeData.store || employeeData.outlet || employeeData.location;

  if (!rawStoreId && !rawStoreName && typeof employeeData === 'string') {
    rawStoreName = employeeData;
  }

  if (!rawStoreId && !rawStoreName) {
    return { storeId: null, officeId: null };
  }

  try {
    let store: any = null;

    if (rawStoreId && !isNaN(Number(rawStoreId))) {
      const numId = Number(rawStoreId);
      store = await prisma.store.findUnique({ where: { id: numId } }).catch(() => null);
    }

    if (!store && rawStoreId) {
      const idStr = String(rawStoreId).trim();
      store = await prisma.store.findFirst({
        where: {
          OR: [
            { code: { equals: idStr, mode: 'insensitive' } },
            { name: { equals: idStr, mode: 'insensitive' } }
          ]
        }
      }).catch(() => null);
    }

    if (!store && rawStoreName) {
      const nameStr = String(rawStoreName).trim();
      if (nameStr) {
        store = await prisma.store.findFirst({
          where: { name: { equals: nameStr, mode: 'insensitive' } }
        }).catch(() => null);
      }
    }

    const displayName = rawStoreName ? String(rawStoreName).trim() : (rawStoreId ? `Store ${rawStoreId}` : 'Main Store');
    if (!store && displayName) {
      const baseCode = displayName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase() || 'STORE';
      const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      store = await prisma.store.create({
        data: {
          name: displayName,
          code: `${baseCode}_${randomSuffix}`,
        }
      });
      console.log(`[Store Resolve] ✅ Auto-created missing Store "${displayName}" (ID: ${store.id})`);
    }

    if (!store) return { storeId: null, officeId: null };

    let office = await prisma.office.findFirst({
      where: {
        OR: [
          ...(store.code ? [{ code: store.code }] : []),
          { name: { equals: store.name, mode: 'insensitive' } }
        ]
      }
    }).catch(() => null);

    if (!office) {
      const baseCode = store.code || `OFF_${store.id}`;
      office = await prisma.office.create({
        data: {
          name: store.name,
          code: baseCode,
          address: store.address || store.name,
          latitude: store.latitude || 0.0,
          longitude: store.longitude || 0.0,
          maxPunchRadiusMeters: store.maxPunchRadiusMeters || 50.0,
        }
      }).catch(() => null);
    }

    return { storeId: store.id, officeId: office ? office.id : null };
  } catch (err: any) {
    console.error('[Store/Office Resolve Error]:', err.message);
    return { storeId: null, officeId: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7️⃣ EMPLOYEE CREATED - New employee from HopKid
// ═══════════════════════════════════════════════════════════════════════════

router.post('/created', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [EMPLOYEE CREATED] Webhook received                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Employee received'
  });

  processEmployeeCreated(rawPayload).catch(err => {
    console.error('[Employee Created] ❌ Error:', err.message);
  });
});

export async function processEmployeeCreated(payload: any): Promise<void> {
  try {
    console.log('[Process] Step 1: Extract employee identifier');

    const empCode = extractEmployeeIdentifier(payload);
    if (!empCode) {
      console.error('[Process] ❌ Invalid payload structure: missing employee identifier');
      await createWebhookLog({
        eventType: 'EMPLOYEE_CREATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload structure: missing employee identifier'
      });
      return;
    }

    const data = payload.data || payload;
    const employee = data.employee || payload.employee || data;
    const hopkidEmployeeId = employee.employeeID || employee.id ? String(employee.employeeID || employee.id).toLowerCase() : null;

    const rawMobile = employee.mobileNo || employee.mobileNumber || employee.phone || employee.phoneNumber || employee.contactNo;
    const mobileNumber = rawMobile ? String(rawMobile).trim() : null;

    const rawComm = employee.commissionRate !== undefined ? employee.commissionRate :
                    (employee.commissionPercentage !== undefined ? employee.commissionPercentage :
                    (employee.commission !== undefined ? employee.commission : 0));
    const commissionRate = isNaN(Number(rawComm)) ? 0 : Number(rawComm);

    const rawSalary = employee.basicSalary || employee.salary || employee.basicPay || employee.grossSalary;
    const basicSalary = rawSalary !== undefined && rawSalary !== null ? Number(rawSalary) : 0;

    const { storeId, officeId } = await resolveStoreAndOffice(employee);

    console.log('[Process] ✅ Valid employee payload:', {
      name: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      code: empCode,
      phone: mobileNumber,
      commissionRate: commissionRate,
      salary: basicSalary,
      storeId: storeId
    });

    const existing = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: { equals: empCode, mode: 'insensitive' as any } },
          ...(hopkidEmployeeId ? [{ employeeID: { equals: hopkidEmployeeId, mode: 'insensitive' as any } }] : [])
        ]
      }
    }).catch(() => null);

    if (existing) {
      console.log('[Process] ⚠️ Employee already exists:', existing.id);
      await createWebhookLog({
        eventType: 'EMPLOYEE_CREATED',
        status: 'SUCCESS',
        payload: payload,
        employeeId: existing.id,
        errorMessage: 'Employee already exists'
      });
      return;
    }

    console.log('[Process] ✅ New employee, creating...');

    const rawName = String(employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Employee').trim();
    const nameParts = rawName.split(' ');
    const firstName = nameParts[0] || 'HopKid';
    const lastName = nameParts.slice(1).join(' ') || 'Employee';

    const designation = employee.designation || employee.role || null;

    const newEmployee = await prisma.employee.create({
      data: {
        employeeID: hopkidEmployeeId,
        employeeCode: empCode,
        firstName,
        lastName,
        mobileNumber,
        designation,
        commissionPercentage: commissionRate,
        storeId,
        officeId,
        status: 'active',
        source: 'HOPKID'
      }
    });

    console.log('[Process] ✅ Employee created:', {
      id: newEmployee.id,
      name: `${newEmployee.firstName} ${newEmployee.lastName}`,
      code: newEmployee.employeeCode,
      mobile: newEmployee.mobileNumber,
      commission: newEmployee.commissionPercentage
    });

    if (basicSalary > 0) {
      console.log(`[Process] Creating Salary Structure with basicSalary: ₹${basicSalary}`);
      await prisma.salaryStructure.upsert({
        where: { employeeId: newEmployee.id },
        update: {
          basicSalary: basicSalary,
          grossSalary: basicSalary,
          monthlySalary: basicSalary,
          updatedAt: new Date()
        },
        create: {
          employeeId: newEmployee.id,
          basicSalary: basicSalary,
          grossSalary: basicSalary,
          monthlySalary: basicSalary,
        }
      });
    }

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const calculation = await CommissionService.calculateMonthlyCommission(newEmployee.id, month);
    await CommissionService.upsertMonthlyCommission(newEmployee.id, month, calculation);

    await createWebhookLog({
      eventType: 'EMPLOYEE_CREATED',
      status: 'SUCCESS',
      payload: payload,
      employeeId: newEmployee.id
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [EMPLOYEE CREATED] ✅ COMPLETE                             ║');
    console.log(`║ Employee: ${newEmployee.firstName} ${newEmployee.lastName} (${newEmployee.employeeCode})`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Process] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'EMPLOYEE_CREATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8️⃣ EMPLOYEE UPDATED - Salary, commission rate, mobile, or store changes
// ═══════════════════════════════════════════════════════════════════════════

router.post('/updated', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [EMPLOYEE UPDATED] Webhook received                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Employee update received'
  });

  processEmployeeUpdated(rawPayload).catch(err => {
    console.error('[Employee Update] ❌ Error:', err.message);
  });
});

export async function processEmployeeUpdated(payload: any): Promise<void> {
  try {
    console.log('[Update] Step 1: Extract employee identifier');

    const empCode = extractEmployeeIdentifier(payload);
    if (!empCode) {
      console.error('[Update] ❌ Invalid payload: missing employee identifier');
      await createWebhookLog({
        eventType: 'EMPLOYEE_UPDATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing employee identifier'
      });
      return;
    }

    const data = payload.data || payload;
    const employee = data.employee || payload.employee || data;
    const hopkidEmployeeId = employee.employeeID || employee.id ? String(employee.employeeID || employee.id).toLowerCase() : null;

    let existingEmployee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: { equals: empCode, mode: 'insensitive' as any } },
          ...(hopkidEmployeeId ? [{ employeeID: { equals: hopkidEmployeeId, mode: 'insensitive' as any } }] : [])
        ]
      }
    });

    if (!existingEmployee) {
      console.warn('[Update] ⚠️ Employee not found, creating new via processEmployeeCreated...');
      await processEmployeeCreated(payload);
      return;
    }

    const currentName = `${existingEmployee.firstName} ${existingEmployee.lastName}`;
    console.log('[Update] ✅ Employee found:', currentName);

    const updateData: any = {};
    const changes: string[] = [];

    if (employee.name || employee.firstName) {
      const rawName = String(employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()).trim();
      const nameParts = rawName.split(' ');
      const newFirst = nameParts[0] || existingEmployee.firstName;
      const newLast = nameParts.slice(1).join(' ') || existingEmployee.lastName;

      if (newFirst !== existingEmployee.firstName || newLast !== existingEmployee.lastName) {
        updateData.firstName = newFirst;
        updateData.lastName = newLast;
        changes.push(`Name: ${currentName} → ${rawName}`);
      }
    }

    const rawMobile = employee.mobileNo || employee.mobileNumber || employee.phone || employee.phoneNumber || employee.contactNo;
    if (rawMobile !== undefined && rawMobile !== null) {
      const cleanMobile = String(rawMobile).trim();
      if (cleanMobile !== existingEmployee.mobileNumber) {
        updateData.mobileNumber = cleanMobile;
        changes.push(`Phone: ${existingEmployee.mobileNumber || 'N/A'} → ${cleanMobile}`);
      }
    }

    const rawComm = employee.commissionRate !== undefined ? employee.commissionRate :
                    (employee.commissionPercentage !== undefined ? employee.commissionPercentage :
                    (employee.commission !== undefined ? employee.commission : undefined));
    if (rawComm !== undefined && rawComm !== null) {
      const newRate = isNaN(Number(rawComm)) ? 0 : Number(rawComm);
      if (newRate !== existingEmployee.commissionPercentage) {
        updateData.commissionPercentage = newRate;
        changes.push(`Commission: ${existingEmployee.commissionPercentage}% → ${newRate}%`);
      }
    }

    if (employee.designation !== undefined || employee.role !== undefined) {
      const newDesig = employee.designation || employee.role || null;
      if (newDesig !== existingEmployee.designation) {
        updateData.designation = newDesig;
        changes.push(`Designation: ${existingEmployee.designation || 'N/A'} → ${newDesig}`);
      }
    }

    const { storeId, officeId } = await resolveStoreAndOffice(employee);
    if (storeId !== null && storeId !== existingEmployee.storeId) {
      updateData.storeId = storeId;
      if (officeId) updateData.officeId = officeId;
      changes.push(`Store/Branch ID: ${existingEmployee.storeId || 'None'} → ${storeId}`);
    }

    const rawSalary = employee.basicSalary || employee.salary || employee.basicPay || employee.grossSalary;
    if (rawSalary !== undefined && rawSalary !== null) {
      const newSalary = Number(rawSalary);
      changes.push(`Salary: ₹${newSalary}`);

      await prisma.salaryStructure.upsert({
        where: { employeeId: existingEmployee.id },
        update: {
          basicSalary: newSalary,
          grossSalary: newSalary,
          monthlySalary: newSalary,
          updatedAt: new Date()
        },
        create: {
          employeeId: existingEmployee.id,
          basicSalary: newSalary,
          grossSalary: newSalary,
          monthlySalary: newSalary
        }
      });
    }

    if (changes.length > 0) {
      console.log('[Update] ✅ Changes applied:', changes);
      updateData.updatedAt = new Date();

      await prisma.employee.update({
        where: { id: existingEmployee.id },
        data: updateData
      });
    }

    if (updateData.commissionPercentage !== undefined) {
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const calculation = await CommissionService.calculateMonthlyCommission(
        existingEmployee.id,
        month
      );

      await CommissionService.upsertMonthlyCommission(
        existingEmployee.id,
        month,
        calculation
      );
    }

    await createWebhookLog({
      eventType: 'EMPLOYEE_UPDATED',
      status: 'SUCCESS',
      payload: payload,
      employeeId: existingEmployee.id
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [EMPLOYEE UPDATED] ✅ COMPLETE                             ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Update] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'EMPLOYEE_UPDATED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9️⃣ EMPLOYEE DELETED - Soft delete/deactivate
// ═══════════════════════════════════════════════════════════════════════════

router.post('/deleted', (req: Request, res: Response) => {
  const rawPayload = req.body;

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ [EMPLOYEE DELETED] Webhook received                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  res.status(200).json({
    success: true,
    message: 'Employee delete received'
  });

  processEmployeeDeleted(rawPayload).catch(err => {
    console.error('[Employee Delete] ❌ Error:', err.message);
  });
});

export async function processEmployeeDeleted(payload: any): Promise<void> {
  try {
    console.log('[Delete] Step 1: Extract employee identifier from payload');

    const identifier = extractEmployeeIdentifier(payload);
    if (!identifier) {
      console.error('[Delete] ❌ Missing employee identifier in payload');
      await createWebhookLog({
        eventType: 'EMPLOYEE_DELETED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing employee identifier'
      });
      return;
    }

    console.log('[Delete] Target employee identifier:', identifier);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: FIND EXISTING EMPLOYEE BEFORE DEACTIVATION
    // ═════════════════════════════════════════════════════════════════════════

    const existingEmployee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: { equals: identifier, mode: 'insensitive' as any } },
          { employeeID: { equals: identifier, mode: 'insensitive' as any } },
          ...(identifier.length >= 7 ? [{ mobileNumber: { contains: identifier.slice(-10) } }] : [])
        ]
      },
      include: { store: true, office: true }
    });

    if (!existingEmployee) {
      console.warn('[Delete] ⚠️ Employee not found in local DB:', identifier);
      await createWebhookLog({
        eventType: 'EMPLOYEE_DELETED',
        status: 'SUCCESS',
        payload: payload,
        errorMessage: `Employee not found for identifier "${identifier}"`
      });
      return;
    }

    const empName = `${existingEmployee.firstName} ${existingEmployee.lastName}`.trim();
    console.log('[Delete] ✅ Employee found in DB BEFORE deactivation:', {
      id: existingEmployee.id,
      name: empName,
      code: existingEmployee.employeeCode,
      store: existingEmployee.store?.name
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: CREATE WEBHOOK LOG LINKED TO AUTHORITATIVE EMPLOYEE RECORD
    // ═════════════════════════════════════════════════════════════════════════

    await createWebhookLog({
      eventType: 'EMPLOYEE_DELETED',
      status: 'SUCCESS',
      payload: payload,
      employeeId: existingEmployee.id
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: MARK EMPLOYEE INACTIVE (SOFT DELETE) - PRESERVE ALL HISTORICAL DATA
    // ═════════════════════════════════════════════════════════════════════════

    await prisma.employee.update({
      where: { id: existingEmployee.id },
      data: {
        status: 'inactive',
        updatedAt: new Date()
      }
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [EMPLOYEE DELETED] ✅ COMPLETE                             ║');
    console.log(`║ Employee: ${empName} (${existingEmployee.employeeCode})`);
    console.log('║ Status: INACTIVE (soft deleted)                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error: any) {
    console.error('[Delete] 💥 FATAL ERROR:', error.message);
    await createWebhookLog({
      eventType: 'EMPLOYEE_DELETED',
      status: 'FAILED',
      payload: payload,
      errorMessage: error.message
    });
  }
}

export default router;
