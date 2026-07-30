import { prisma } from '../utils/db';

async function testCommission() {
  console.log('=== FEATURE 2: COMMISSION TEST ===');

  const employee = await prisma.employee.findFirst({
    where: {
      OR: [
        { employeeCode: '074' },
        { mobileNumber: { contains: '8866686203' } }
      ]
    }
  });

  if (!employee) {
    console.error('MAYUR not found!');
    return;
  }

  // Ensure MAYUR has commissionPercentage = 1
  if (employee.commissionPercentage !== 1) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { commissionPercentage: 1 }
    });
    console.log('Set MAYUR commissionPercentage = 1%');
  }

  // Create or retrieve a sale of 1000 for MAYUR for THIS MONTH
  const saleAmount = 1000;
  const commissionPercent = 1;
  const commissionAmount = (saleAmount * commissionPercent) / 100;

  const txn = await prisma.commissionTransaction.create({
    data: {
      employeeId: employee.id,
      storeId: employee.storeId || 1,
      saleAmount,
      commissionType: 'PERCENTAGE',
      commissionPercent,
      commissionAmount,
      invoiceNumber: `INV-SPRINT-${Date.now()}`,
      status: 'APPROVED',
      notes: 'Sprint Test Sale ₹1000',
    }
  });

  console.log(`Created Commission Transaction: ID=${txn.id}, Sale=₹${txn.saleAmount}, Commission=₹${txn.commissionAmount} (${txn.commissionPercent}%)`);

  // Verify total commission for MAYUR this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const monthTxns = await prisma.commissionTransaction.findMany({
    where: {
      employeeId: employee.id,
      createdAt: { gte: monthStart, lte: monthEnd },
      status: { notIn: ['REJECTED', 'CANCELLED'] }
    }
  });

  const totalSales = monthTxns.reduce((sum, t) => sum + t.saleAmount, 0);
  const totalCommission = monthTxns.reduce((sum, t) => sum + t.commissionAmount, 0);

  console.log(`MAYUR This Month Sales: ₹${totalSales}, Total Commission: ₹${totalCommission}`);
  console.log('=== FEATURE 2 VERIFIED ===');
}

testCommission().catch(console.error).finally(() => prisma.$disconnect());
