import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog } from '../utils/commissionHelper';

const router = Router();

console.log('[Employee Webhook Controller] ✅ Loaded');

/**
 * Helper to resolve or auto-create matching Store & Office for branch names
 */
async function resolveStoreAndOffice(branchNameInput: string | null | undefined): Promise<{ storeId: number | null; officeId: number | null }> {
  if (!branchNameInput) return { storeId: null, officeId: null };

  const branchName = String(branchNameInput).trim();
  if (!branchName) return { storeId: null, officeId: null };

  try {
    let store = await prisma.store.findFirst({
      where: { name: { equals: branchName, mode: 'insensitive' } }
    });

    if (!store) {
      const baseCode = branchName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase() || 'STORE';
      const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      store = await prisma.store.create({
        data: {
          name: branchName,
          code: `${baseCode}_${randomSuffix}`,
        }
      });
      console.log(`[Store Resolve] ✅ Created Store for branch "${branchName}" (ID: ${store.id})`);
    }

    let office = await prisma.office.findFirst({
      where: { name: { equals: branchName, mode: 'insensitive' } }
    });

    if (!office) {
      const baseCode = branchName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase() || 'OFFICE';
      const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      office = await prisma.office.create({
        data: {
          name: branchName,
          code: `${baseCode}_${randomSuffix}`,
          address: store.address || branchName,
          latitude: store.latitude || 0.0,
          longitude: store.longitude || 0.0,
          maxPunchRadiusMeters: store.maxPunchRadiusMeters || 50.0,
        }
      });
      console.log(`[Office Resolve] ✅ Created Office for branch "${branchName}" (ID: ${office.id})`);
    }

    return { storeId: store.id, officeId: office.id };
  } catch (err: any) {
    console.error('[Store/Office Resolve Error]:', err.message);
    return { storeId: null, officeId: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7️⃣ EMPLOYEE CREATED - New employee from HopKid
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhook/employee/created
 * HopKid sends: employee.created event
 */
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
    console.log('[Process] Step 1: Validate payload');

    const data = payload.data || payload;
    const employee = data.employee || payload.employee || data;
    if (!employee || (!employee.employeeCode && !employee.code && !employee.employeeID)) {
      console.error('[Process] ❌ Invalid payload structure: missing employee identifier');
      await createWebhookLog({
        eventType: 'EMPLOYEE_CREATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload structure: missing employeeCode'
      });
      return;
    }

    const empCode = String(employee.employeeCode || employee.code || employee.empCode || employee.employeeID);
    const hopkidEmployeeId = employee.employeeID || employee.id ? String(employee.employeeID || employee.id).toLowerCase() : null;

    const rawMobile = employee.mobileNo || employee.mobileNumber || employee.phone || employee.phoneNumber || employee.contactNo;
    const mobileNumber = rawMobile ? String(rawMobile).trim() : null;

    // Parse commission rate cleanly without defaulting 0% to 1%
    const rawComm = employee.commissionRate !== undefined ? employee.commissionRate :
                    (employee.commissionPercentage !== undefined ? employee.commissionPercentage :
                    (employee.commission !== undefined ? employee.commission : 0));
    const commissionRate = isNaN(Number(rawComm)) ? 0 : Number(rawComm);

    const rawSalary = employee.basicSalary || employee.salary || employee.basicPay || employee.grossSalary;
    const basicSalary = rawSalary !== undefined && rawSalary !== null ? Number(rawSalary) : 0;

    console.log('[Process] ✅ Valid employee payload:', {
      name: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      code: empCode,
      phone: mobileNumber,
      commissionRate: commissionRate,
      salary: basicSalary,
      branch: employee.branchName || employee.store || employee.storeName
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: CHECK IF ALREADY EXISTS
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 2: Check if employee exists');

    const existing = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: empCode },
          ...(hopkidEmployeeId ? [{ employeeID: hopkidEmployeeId }] : [])
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

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: RESOLVE STORE & OFFICE
    // ═════════════════════════════════════════════════════════════════════════

    const branchInput = employee.branchName || employee.store || employee.storeName || employee.branch;
    const { storeId, officeId } = await resolveStoreAndOffice(branchInput);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CREATE EMPLOYEE RECORD
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 4: Create employee record');

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

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: UPSERT SALARY STRUCTURE IF PROVIDED
    // ═════════════════════════════════════════════════════════════════════════

    if (basicSalary > 0) {
      console.log(`[Process] Step 5: Creating Salary Structure with basicSalary: ₹${basicSalary}`);
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
      console.log('[Process] ✅ Salary structure created');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 6: CREATE INITIAL COMMISSION RECORD FOR THIS MONTH
    // ═════════════════════════════════════════════════════════════════════════

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const calculation = await CommissionService.calculateMonthlyCommission(newEmployee.id, month);
    await CommissionService.upsertMonthlyCommission(newEmployee.id, month, calculation);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 7: CREATE WEBHOOK LOG
    // ═════════════════════════════════════════════════════════════════════════

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

/**
 * POST /api/webhook/employee/updated
 * HopKid sends: employee.updated event
 */
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
    console.log('[Update] Step 1: Validate payload');

    const data = payload.data || payload;
    const employee = data.employee || payload.employee || data;
    if (!employee || (!employee.employeeCode && !employee.code && !employee.employeeID)) {
      console.error('[Update] ❌ Invalid payload: missing employeeCode');
      await createWebhookLog({
        eventType: 'EMPLOYEE_UPDATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing employeeCode'
      });
      return;
    }

    const empCode = String(employee.employeeCode || employee.code || employee.empCode || employee.employeeID);
    const hopkidEmployeeId = employee.employeeID || employee.id ? String(employee.employeeID || employee.id).toLowerCase() : null;

    console.log('[Update] Employee identifier:', empCode);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: FIND EMPLOYEE
    // ═════════════════════════════════════════════════════════════════════════

    let existingEmployee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: empCode },
          ...(hopkidEmployeeId ? [{ employeeID: hopkidEmployeeId }] : [])
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

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: PREPARE PATCH-STYLE UPDATE DATA
    // ═════════════════════════════════════════════════════════════════════════

    const updateData: any = {};
    const changes: string[] = [];

    // Name update
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

    // Mobile number update
    const rawMobile = employee.mobileNo || employee.mobileNumber || employee.phone || employee.phoneNumber || employee.contactNo;
    if (rawMobile !== undefined && rawMobile !== null) {
      const cleanMobile = String(rawMobile).trim();
      if (cleanMobile !== existingEmployee.mobileNumber) {
        updateData.mobileNumber = cleanMobile;
        changes.push(`Phone: ${existingEmployee.mobileNumber || 'N/A'} → ${cleanMobile}`);
      }
    }

    // Commission rate update (supports 2% → 0% and 0% → 1%)
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

    // Designation update
    if (employee.designation !== undefined || employee.role !== undefined) {
      const newDesig = employee.designation || employee.role || null;
      if (newDesig !== existingEmployee.designation) {
        updateData.designation = newDesig;
        changes.push(`Designation: ${existingEmployee.designation || 'N/A'} → ${newDesig}`);
      }
    }

    // Branch / Store update
    const branchInput = employee.branchName || employee.store || employee.storeName || employee.branch;
    if (branchInput) {
      const { storeId, officeId } = await resolveStoreAndOffice(branchInput);
      if (storeId && storeId !== existingEmployee.storeId) {
        updateData.storeId = storeId;
        updateData.officeId = officeId;
        changes.push(`Store/Branch: ${branchInput}`);
      }
    }

    // Salary structure update if salary is present
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
      console.log(`[Update] ✅ Salary structure updated: ₹${newSalary}`);
    }

    if (changes.length > 0) {
      console.log('[Update] ✅ Changes applied:', changes);
      updateData.updatedAt = new Date();

      await prisma.employee.update({
        where: { id: existingEmployee.id },
        data: updateData
      });

      console.log('[Update] ✅ Employee record updated in DB');
    } else {
      console.log('[Update] ℹ️ No employee field changes detected');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: RECALCULATE COMMISSION IF RATE CHANGED
    // ═════════════════════════════════════════════════════════════════════════

    if (updateData.commissionPercentage !== undefined) {
      console.log('[Update] Step 4: Recalculate monthly commission (rate changed)');

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

      console.log('[Update] ✅ Commission recalculated:', {
        newRate: updateData.commissionPercentage,
        newCommission: calculation.totalCommissionAmount
      });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: CREATE WEBHOOK LOG
    // ═════════════════════════════════════════════════════════════════════════

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

/**
 * POST /api/webhook/employee/deleted
 * HopKid sends: employee.deleted event
 */
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
    console.log('[Delete] Step 1: Validate payload');

    const data = payload.data || payload;
    const employee = data.employee || payload.employee || data;
    if (!employee || (!employee.employeeCode && !employee.code && !employee.employeeID)) {
      console.error('[Delete] ❌ Invalid payload: missing employeeCode');
      await createWebhookLog({
        eventType: 'EMPLOYEE_DELETED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing employeeCode'
      });
      return;
    }

    const empCode = String(employee.employeeCode || employee.code || employee.empCode || employee.employeeID);
    const hopkidEmployeeId = employee.employeeID || employee.id ? String(employee.employeeID || employee.id).toLowerCase() : null;

    console.log('[Delete] Employee code:', empCode);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: FIND EMPLOYEE
    // ═════════════════════════════════════════════════════════════════════════

    const existingEmployee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: empCode },
          ...(hopkidEmployeeId ? [{ employeeID: hopkidEmployeeId }] : [])
        ]
      }
    });

    if (!existingEmployee) {
      console.warn('[Delete] ⚠️ Employee not found');
      await createWebhookLog({
        eventType: 'EMPLOYEE_DELETED',
        status: 'SUCCESS',
        payload: payload,
        errorMessage: 'Employee not found'
      });
      return;
    }

    const empName = `${existingEmployee.firstName} ${existingEmployee.lastName}`;
    console.log('[Delete] ✅ Employee found:', empName);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: SOFT DELETE (MARK INACTIVE - PRESERVE HISTORICAL DATA)
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Delete] Step 3: Deactivate employee (soft delete)');

    await prisma.employee.update({
      where: { id: existingEmployee.id },
      data: {
        status: 'inactive',
        updatedAt: new Date()
      }
    });

    console.log('[Delete] ✅ Employee deactivated (soft delete)');

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: CREATE WEBHOOK LOG
    // ═════════════════════════════════════════════════════════════════════════

    await createWebhookLog({
      eventType: 'EMPLOYEE_DELETED',
      status: 'SUCCESS',
      payload: payload,
      employeeId: existingEmployee.id
    });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║ [EMPLOYEE DELETED] ✅ COMPLETE                             ║');
    console.log(`║ Employee: ${empName} (${existingEmployee.employeeCode})`);
    console.log('║ Status: INACTIVE                                           ║');
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
