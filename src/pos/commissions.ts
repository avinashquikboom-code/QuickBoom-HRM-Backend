import { reverseRetailCommission } from "./retailCommissions";
import { Prisma } from "@prisma/client";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../utils/db";
import { Actor, authenticate, POSRequest, permission, scope } from "./auth";
import { ensure, integer, object, keys, text } from "./validation";
import { refundAllocation } from "./finance";
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

/** Same aggregation path as legacy HRM; POS proposals require explicit approval. */
export function commissionPayrollWhere(
  employeeId: number,
  gte: Date,
  lte: Date,
): Prisma.CommissionTransactionWhereInput {
  return {
    employeeId,
    AND: [
      { OR: [{ eventType: null }, { eventType: { not: "RKD_REQUEST" } }] },
      { OR: [{ billId: null }, { billId: { not: { startsWith: "RKD-" } } }] },
      {
        OR: [
          {
            AND: [
              {
                OR: [
                  { eventType: null },
                  { eventType: { not: { startsWith: "POS_" } } },
                ],
              },
              { createdAt: { gte, lte } },
              { status: { in: ["PENDING", "APPROVED", "PAID"] } },
            ],
          },
          {
            eventType: { startsWith: "POS_" },
            approvedAt: { gte, lte },
            status: { in: ["APPROVED", "PAID"] },
          },
        ],
      },
    ],
  };
}
// New retail accrual never enters the employee/payroll commission ledger.
export { accrueRetailCommission as accrueCommission } from "./retailCommissions";
export async function reverseCommission(
  tx: Tx,
  actor: Actor,
  returnId: string,
) {
  const ret = await tx.pOSReturn.findUniqueOrThrow({
    where: { id: returnId },
    include: {
      sale: true,
      items: { include: { saleItem: { include: { commission: true } } } },
    },
  });
  await reverseRetailCommission(tx, ret.id, ret.items.map(i => ({ id: i.saleItemId, returnedQuantity: i.saleItem.returnedQuantity })));
  const lines = ret.items.filter((i) => i.saleItem.commission);
  if (!lines.length) return;

  const byTransaction = new Map<number, typeof lines>();
  for (const item of lines) {
    const tId = item.saleItem.commission!.transactionId;
    const list = byTransaction.get(tId) ?? [];
    list.push(item);
    byTransaction.set(tId, list);
  }

  for (const [transactionId, txLines] of byTransaction.entries()) {
    let total = new D(0),
      revenue = new D(0);
    const detail = [];
    for (const item of txLines) {
      const commission = item.saleItem.commission!;
      const amount = refundAllocation(
        commission.amount,
        item.saleItem.quantity,
        item.saleItem.returnedQuantity - item.quantity,
        item.quantity,
      );
      total = total.plus(amount);
      revenue = revenue.plus(
        (commission.policySnapshot as Record<string, unknown>).basis ===
          "NET_INCL_TAX"
          ? item.refundAmount
          : item.revenueRefund,
      );
      await tx.pOSCommissionLine.update({
        where: { id: commission.id },
        data: { reversedAmount: { increment: amount } },
      });
      detail.push({
        saleItemId: item.saleItemId,
        returnItemId: item.id,
        amount: amount.negated().toFixed(2),
        originalTransactionId: commission.transactionId,
      });
    }
    const original = await tx.commissionTransaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    // Unapproved earnings have never entered payroll: reduce their outstanding proposal in place with history.
    if (original.status === "PENDING") {
      const remaining = new D(String(original.commissionAmount)).minus(total);
      const status = remaining.isZero() ? "REJECTED" : "PENDING";
      await tx.commissionTransaction.update({
        where: { id: original.id },
        data: {
          commissionAmount: remaining.toNumber(),
          saleAmount: new D(String(original.saleAmount))
            .minus(revenue)
            .toNumber(),
          status,
        },
      });
      await tx.commissionHistory.create({
        data: {
          transactionId: original.id,
          employeeId: original.employeeId,
          action: "ADJUSTED",
          previousStatus: original.status,
          newStatus: status,
          previousAmount: original.commissionAmount,
          newAmount: remaining.toNumber(),
          performedBy: actor.userId,
          reason: `Original-value POS refund ${ret.id}`,
        },
      });
    } else if (["APPROVED", "PAID"].includes(original.status) && total.gt(0)) {
      // Never change paid/frozen earnings. A separate debit requires explicit review before entering an open payroll period.
      const debit = await tx.commissionTransaction.create({
        data: {
          billId: `POSRETURN-${ret.id}-${transactionId}`,
          invoiceNumber: ret.sale.invoiceNo,
          employeeId: original.employeeId,
          storeId: ret.sale.storeId,
          saleAmount: revenue.negated().toNumber(),
          commissionAmount: total.negated().toNumber(),
          commissionType: original.commissionType,
          eventType: "POS_RETURN",
          status: "PENDING",
          productBreakdown: detail,
          notes: `Refund ${ret.id}; original commission #${original.id}; approval required`,
        },
      });
      await tx.commissionHistory.create({
        data: {
          transactionId: debit.id,
          employeeId: debit.employeeId,
          action: "CREATED",
          newStatus: "PENDING",
          newAmount: debit.commissionAmount,
          performedBy: actor.userId,
          reason: "POS refund commission adjustment awaiting approval",
        },
      });
    }
  }
}
export async function reviewCommission(actor: Actor, id: number, raw: unknown) {
  permission(actor, "commissionApprove");
  const b = object(raw);
  keys(b, ["decision", "reason"]);
  ensure(["APPROVED", "REJECTED"].includes(b.decision), "Invalid decision");
  const reason = text(b.reason, "approval reason", 1000);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CommissionTransaction" WHERE id = ${id} FOR UPDATE`;
      const record = await tx.commissionTransaction.findUnique({
        where: { id },
      });
      ensure(
        record && record.eventType?.startsWith("POS_"),
        "POS commission not found",
        404,
      );
      ensure(record.storeId, "Commission store missing", 409);
      scope(actor, record.storeId);
      ensure(
        record.status === "PENDING",
        "Only pending POS proposals can be reviewed",
        409,
      );
      if (b.decision === "APPROVED") {
        if (record.eventType === "POS_SALE") {
          const sale = await tx.pOSSale.findFirst({
            where: {
              id: record.billId?.replace(/^POSSALE-/, ""),
              status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
            },
          });
          ensure(
            sale,
            "Cancelled/returned sale is not commission eligible",
            409,
          );
        }
        const nowIST = new Date(Date.now() + 19800000);
        const slip = await tx.payslip.findUnique({
          where: {
            employeeId_month_year: {
              employeeId: record.employeeId,
              month: nowIST.getUTCMonth() + 1,
              year: nowIST.getUTCFullYear(),
            },
          },
        });
        ensure(
          !slip ||
            ![
              "PAID",
              "FINALIZED",
              "DISBURSED",
              "COMPLETED",
              "APPROVED",
            ].includes(slip.status.toUpperCase()),
          "Current payroll period is frozen; review in an open payroll period",
          409,
        );
      }
      const result = await tx.commissionTransaction.update({
        where: { id },
        data: {
          status: b.decision,
          approvedAt: new Date(),
          approvedBy: actor.userId,
          notes: reason,
        },
      });
      await tx.commissionHistory.create({
        data: {
          transactionId: id,
          employeeId: record.employeeId,
          action: b.decision,
          previousStatus: record.status,
          newStatus: b.decision,
          previousAmount: record.commissionAmount,
          newAmount: record.commissionAmount,
          performedBy: actor.userId,
          reason,
        },
      });
      await tx.pOSAuditLog.create({
        data: {
          userId: actor.userId,
          action: "COMMISSION_REVIEWED",
          entityId: String(id),
          metadata: { decision: b.decision, reason },
        },
      });
      return result;
    },
    { isolationLevel: "Serializable" },
  );
}
/** Protect POS proposals even when reviewed via the existing HRM approval endpoints. */
export function protectLegacyPOSReview(decision: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id)) return next();
      const record = await prisma.commissionTransaction.findUnique({
        where: { id },
        select: { eventType: true },
      });
      if (!record?.eventType?.startsWith("POS_")) return next();
      await authenticate(req, res, async (error) => {
        try {
          if (error) throw error;
          const data = await reviewCommission(
            (req as POSRequest).actor,
            integer(id, "id"),
            { decision, reason: req.body?.notes },
          );
          res.json({ success: true, transaction: data });
        } catch (e) {
          const err = e as { status?: number; message?: string };
          res.status(err.status ?? 500).json({
            success: false,
            message: err.status ? err.message : "POS commission review failed",
          });
        }
      });
    } catch (e) {
      next(e);
    }
  };
}
