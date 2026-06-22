import { prisma } from '../src/utils/db';

async function assignOffice() {
  const args = process.argv.slice(2);
  const email = args[0];
  const officeIdStr = args[1];

  if (!email || !officeIdStr) {
    console.log('Usage: npx ts-node scripts/assign_office.ts <email> <officeId>');
    return;
  }

  const officeId = parseInt(officeIdStr, 10);
  if (isNaN(officeId)) {
    console.log('Error: officeId must be a valid number.');
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { employee: true },
    });

    if (!user) {
      console.log(`User not found with email: ${email}`);
      return;
    }

    if (!user.employee) {
      console.log(`Employee record not found for user: ${email}`);
      return;
    }

    const office = await prisma.office.findUnique({
      where: { id: officeId },
    });

    if (!office) {
      console.log(`Office not found with ID: ${officeId}`);
      return;
    }

    // Update officeId
    const updatedEmployee = await prisma.employee.update({
      where: { id: user.employee.id },
      data: {
        officeId,
      },
      include: {
        office: true,
      }
    });

    console.log(`Successfully assigned employee ${updatedEmployee.firstName} ${updatedEmployee.lastName} (ID: ${updatedEmployee.id}) to office: ${updatedEmployee.office?.name || 'NULL'} (ID: ${updatedEmployee.officeId})`);

  } catch (e: any) {
    console.error('Error assigning office:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

assignOffice();
