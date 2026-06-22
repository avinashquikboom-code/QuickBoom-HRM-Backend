import { prisma } from '../src/utils/db';

async function checkDetails() {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        user: {
          select: {
            email: true,
            role: true,
            isActive: true,
          }
        },
        office: {
          select: {
            name: true,
            id: true,
          }
        },
        department: {
          select: {
            name: true,
            id: true,
          }
        }
      }
    });

    console.log('--- DETAILED EMPLOYEE LIST ---');
    employees.forEach(emp => {
      console.log(`ID: ${emp.id}`);
      console.log(`Code: ${emp.employeeCode}`);
      console.log(`Name: ${emp.firstName} ${emp.lastName}`);
      console.log(`Designation: ${emp.designation}`);
      console.log(`Status: ${emp.status}`);
      console.log(`Office: ${emp.office ? `${emp.office.name} (ID: ${emp.office.id})` : 'NULL'}`);
      console.log(`Department: ${emp.department ? `${emp.department.name} (ID: ${emp.department.id})` : 'NULL'}`);
      console.log(`Associated User Email: ${emp.user?.email || 'NONE'}`);
      console.log(`Associated User Role: ${emp.user?.role || 'NONE'}`);
      console.log(`Associated User Active: ${emp.user?.isActive}`);
      console.log('------------------------------');
    });

  } catch (e: any) {
    console.error('Error:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

checkDetails();
