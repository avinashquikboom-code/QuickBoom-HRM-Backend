import assert from 'node:assert/strict';
import { prisma } from '../src/utils/db';
import { transitionLeaveReview } from '../src/services/leaveReviewTransition';

async function main() {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname), 'Local test database only');
  const employee = await prisma.employee.findFirstOrThrow({ where: { status: 'active' }, select: { id: true } });
  const fixture = await prisma.leaveRequest.create({ data: {
    employeeId: employee.id, type: 'CASUAL', fromDate: new Date('2099-01-01'),
    toDate: new Date('2099-01-01'), reason: 'Temporary CAS integration test; no business side effects', status: 'PENDING',
  } });
  try {
    const results = await Promise.all([
      transitionLeaveReview(fixture.id, 'PENDING', 'APPROVED', 'Integration test', 'Test'),
      transitionLeaveReview(fixture.id, 'PENDING', 'APPROVED', 'Integration test', 'Test'),
    ]);
    assert.equal(results.filter(r => r.changed).length, 1);
    assert(results.every(r => r.leave.status === 'APPROVED'));
    const persisted = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.equal(persisted.status, 'APPROVED');
    assert(persisted.reviewedAt);
    const stale = await transitionLeaveReview(fixture.id, 'PENDING', 'REJECTED', 'Integration test', 'Stale');
    assert.equal(stale.changed, false);
    assert.equal(stale.leave.status, 'APPROVED');
    console.log('PASS real local database: exactly one concurrent approval claims the transition; status/review timestamp persist; stale rejection cannot overwrite approval.');
  } finally {
    await prisma.leaveRequest.delete({ where: { id: fixture.id } });
    await prisma.$disconnect();
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
