import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { notifyEmployee, sendHRNotification } from '../utils/hrNotificationHelper';

export async function createExpenseOnce(data: Prisma.ExpenseUncheckedCreateInput, requestId?: string) {
  const submissionKey = requestId ? createHash('sha256').update(`${data.employeeId}:${requestId}`).digest('hex') : null;
  const sameRequest = (expense: { employeeId: number; category: string; amount: number; description: string; date: Date }) =>
    expense.employeeId === data.employeeId && expense.category === data.category && expense.amount === data.amount &&
    expense.description === data.description && expense.date.getTime() === new Date(data.date).getTime();
  const replay = async () => {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { submissionKey: submissionKey! } });
    if (!sameRequest(expense)) throw Object.assign(new Error('Submission key was already used for a different claim'), { code: 'expense/idempotency-conflict' });
    return { expense, created: false };
  };
  if (submissionKey && await prisma.expense.findUnique({ where: { submissionKey } })) return replay();
  try {
    const expense = await prisma.expense.create({ data: { ...data, submissionKey } });
    return { expense, created: true };
  } catch (error) {
    if (submissionKey && (error as { code?: string }).code === 'P2002') return replay();
    throw error;
  }
}

export async function notifyExpenseSubmitted(expense: { id: number; employeeId: number; amount: number; category: string }, employeeName: string) {
  // Expenses are reviewed by the existing HR/admin workflow in Finance (pa-payroll).
  return sendHRNotification({
    employeeId: expense.employeeId, title: 'Expense Claim Submitted',
    body: `${employeeName} submitted ${expense.category.toLowerCase()} expense #${expense.id} for ₹${expense.amount.toFixed(2)}.`,
    category: 'EXPENSE', actionType: 'EXPENSE_SUBMITTED', actionId: String(expense.id), requiredModuleId: 'pa-payroll',
  });
}

export async function transitionExpenseReview(id: number, previousStatus: string, status: string, reviewedBy: string, reviewNote: string) {
  return prisma.$transaction(async tx => {
    const result = await tx.expense.updateMany({ where: { id, status: previousStatus }, data: { status, reviewedBy, reviewNote } });
    const expense = await tx.expense.findUniqueOrThrow({ where: { id }, include: { employee: true } });
    return { changed: result.count === 1, expense };
  });
}

export async function notifyExpenseReviewed(expense: { id: number; employeeId: number; amount: number; category: string; status: string; description: string; reviewNote: string | null; employee: { userId: number | null } }) {
  return notifyEmployee({
    employeeId: expense.employeeId, userId: expense.employee.userId || undefined,
    title: `Expense Claim ${expense.status.charAt(0)}${expense.status.slice(1).toLowerCase()}`,
    body: `Your ${expense.category.toLowerCase()} claim #${expense.id} for ₹${expense.amount.toFixed(2)} is ${expense.status.toLowerCase()}. ${expense.description}${expense.status === 'REJECTED' && expense.reviewNote ? ` Reason: ${expense.reviewNote}` : ''}`,
    category: 'EXPENSE', actionType: `EXPENSE_${expense.status}`, actionId: String(expense.id),
    extraData: { expenseId: String(expense.id), status: expense.status, amount: String(expense.amount) },
  });
}
