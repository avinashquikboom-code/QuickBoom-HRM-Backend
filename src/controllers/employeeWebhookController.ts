import { Router, Request, Response } from 'express';
import { prisma } from '../utils/db';
import { CommissionService } from '../services/commissionService';
import { createWebhookLog } from '../utils/commissionHelper';

const router = Router();

console.log('[Employee Webhook Controller] ✅ Loaded');

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
    if (!employee || !employee.employeeCode) {
      console.error('[Process] ❌ Invalid payload structure');
      await createWebhookLog({
        eventType: 'EMPLOYEE_CREATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload structure: missing employeeCode'
      });
      return;
    }

    const empCode = String(employee.employeeCode);
    console.log('[Process] ✅ Valid employee:', {
      name: employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      code: empCode,
      phone: employee.mobileNo || employee.mobileNumber || employee.phone,
      email: employee.email,
      salary: employee.basicSalary || employee.salary || employee.basicPay
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: CHECK IF ALREADY EXISTS
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 2: Check if employee exists');

    const existing = await prisma.employee.findUnique({
      where: { employeeCode: empCode }
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
    // STEP 3: CREATE EMPLOYEE
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 3: Create employee record');

    const rawName = String(employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Employee').trim();
    const nameParts = rawName.split(' ');
    const firstName = nameParts[0] || 'HopKid';
    const lastName = nameParts.slice(1).join(' ') || 'Employee';

    const mobileNumber = employee.mobileNo || employee.mobileNumber || employee.phone ? String(employee.mobileNo || employee.mobileNumber || employee.phone) : null;
    const commissionRate = Number(employee.commissionRate || employee.commissionPercentage || 1);
    const basicSalary = Number(employee.basicSalary || employee.salary || employee.basicPay || employee.grossSalary || 0);

    const newEmployee = await prisma.employee.create({
      data: {
        employeeCode: empCode,
        firstName,
        lastName,
        mobileNumber,
        commissionPercentage: commissionRate,
        status: 'active',
        source: 'HOPKID'
      }
    });

    console.log('[Process] ✅ Employee created:', {
      id: newEmployee.id,
      name: `${newEmployee.firstName} ${newEmployee.lastName}`,
      code: newEmployee.employeeCode
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: UPSERT SALARY STRUCTURE
    // ═════════════════════════════════════════════════════════════════════════

    if (basicSalary > 0) {
      console.log(`[Process] Step 4: Creating Salary Structure with basicSalary: ₹${basicSalary}`);
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
    // STEP 5: CREATE INITIAL COMMISSION RECORD FOR THIS MONTH
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Process] Step 5: Create commission record');

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const calculation = await CommissionService.calculateMonthlyCommission(newEmployee.id, month);
    await CommissionService.upsertMonthlyCommission(newEmployee.id, month, calculation);

    console.log('[Process] ✅ Commission record created');

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 6: CREATE WEBHOOK LOG
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
// 8️⃣ EMPLOYEE UPDATED - Salary, commission rate, or other changes
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
    if (!employee || !employee.employeeCode) {
      console.error('[Update] ❌ Invalid payload');
      await createWebhookLog({
        eventType: 'EMPLOYEE_UPDATED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing employeeCode'
      });
      return;
    }

    const empCode = String(employee.employeeCode);
    console.log('[Update] Employee code:', empCode);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: FIND EMPLOYEE
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Update] Step 2: Find employee');

    const existingEmployee = await prisma.employee.findUnique({
      where: { employeeCode: empCode }
    });

    if (!existingEmployee) {
      console.warn('[Update] ⚠️ Employee not found, creating new...');
      await processEmployeeCreated(payload);
      return;
    }

    const currentName = `${existingEmployee.firstName} ${existingEmployee.lastName}`;
    console.log('[Update] ✅ Employee found:', currentName);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: PREPARE UPDATE DATA
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Update] Step 3: Prepare updates');

    const updateData: any = {};
    const changes: string[] = [];

    // Update basic info
    if (employee.name) {
      const rawName = String(employee.name).trim();
      const nameParts = rawName.split(' ');
      const newFirst = nameParts[0] || 'HopKid';
      const newLast = nameParts.slice(1).join(' ') || 'Employee';

      if (newFirst !== existingEmployee.firstName || newLast !== existingEmployee.lastName) {
        updateData.firstName = newFirst;
        updateData.lastName = newLast;
        changes.push(`Name: ${currentName} → ${rawName}`);
      }
    }

    const newPhone = employee.mobileNo || employee.mobileNumber || employee.phone;
    if (newPhone && String(newPhone) !== existingEmployee.mobileNumber) {
      updateData.mobileNumber = String(newPhone);
      changes.push(`Phone: ${existingEmployee.mobileNumber} → ${newPhone}`);
    }

    // Update commission rate
    const newRate = employee.commissionRate !== undefined ? employee.commissionRate : employee.commissionPercentage;
    if (newRate !== undefined && Number(newRate) !== existingEmployee.commissionPercentage) {
      updateData.commissionPercentage = Number(newRate) || 1;
      changes.push(`Commission: ${existingEmployee.commissionPercentage}% → ${newRate}%`);
    }

    // Update salary structure if salary is present
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
      console.log('[Update] ✅ Changes found:', changes);
      updateData.updatedAt = new Date();

      await prisma.employee.update({
        where: { id: existingEmployee.id },
        data: updateData
      });

      console.log('[Update] ✅ Employee updated');
    } else {
      console.log('[Update] ℹ️ No core employee property changes detected');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: IF COMMISSION RATE CHANGED, RECALCULATE CURRENT MONTH
    // ═════════════════════════════════════════════════════════════════════════

    if (updateData.commissionPercentage !== undefined) {
      console.log('[Update] Step 4: Recalculate commission (rate changed)');

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
    if (!employee || !employee.employeeCode) {
      console.error('[Delete] ❌ Invalid payload');
      await createWebhookLog({
        eventType: 'EMPLOYEE_DELETED',
        status: 'FAILED',
        payload: payload,
        errorMessage: 'Invalid payload: missing employeeCode'
      });
      return;
    }

    const empCode = String(employee.employeeCode);
    console.log('[Delete] Employee code:', empCode);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: FIND EMPLOYEE
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Delete] Step 2: Find employee');

    const existingEmployee = await prisma.employee.findUnique({
      where: { employeeCode: empCode }
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
    // STEP 3: SOFT DELETE (MARK INACTIVE)
    // ═════════════════════════════════════════════════════════════════════════

    console.log('[Delete] Step 3: Deactivate employee');

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
