import { prisma } from '../utils/db';

/** Compare-and-set prevents concurrent/retried reviews from repeating side effects. */
export async function transitionLeaveReview(
  id: number,
  previousStatus: string,
  status: 'APPROVED' | 'REJECTED',
  reviewedBy: string,
  reviewNote: string,
) {
  return prisma.$transaction(async tx => {
    const result = await tx.leaveRequest.updateMany({
      where: { id, status: previousStatus },
      data: { status, reviewedBy, reviewNote, reviewedAt: new Date() },
    });
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id }, include: { employee: { include: { user: true } } },
    });
    return { changed: result.count === 1, leave };
  });
}
