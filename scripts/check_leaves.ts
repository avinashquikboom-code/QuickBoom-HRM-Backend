import { prisma } from '../src/utils/db';

async function checkLeaves() {
  try {
    const leaveRequests = await prisma.leaveRequest.findMany({
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          }
        }
      }
    });

    console.log(`--- Total Leave Requests in Database: ${leaveRequests.length} ---`);
    leaveRequests.forEach((req, idx) => {
      console.log(`[${idx + 1}] ID: ${req.id}`);
      console.log(`    Employee: ${req.employee ? `${req.employee.firstName} ${req.employee.lastName} (${req.employee.employeeCode})` : 'NULL'} (ID: ${req.employeeId})`);
      console.log(`    Type: ${req.type}`);
      console.log(`    From: ${req.fromDate.toISOString()}`);
      console.log(`    To: ${req.toDate.toISOString()}`);
      console.log(`    Status: ${req.status}`);
      console.log(`    Reason: ${req.reason}`);
      console.log(`    Applied On: ${req.appliedOn.toISOString()}`);
      console.log(`    Reviewed By: ${req.reviewedBy || 'N/A'}`);
      console.log(`    Review Note: ${req.reviewNote || 'N/A'}`);
      console.log('------------------------------');
    });

  } catch (e: any) {
    console.error('Error:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

checkLeaves();
