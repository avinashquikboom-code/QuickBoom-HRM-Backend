import { Prisma } from "@prisma/client";

// Returns retain the original sale event; their credits post on the return date.
// Cancelled invoices and their cancellation credits are excluded together.
export const recognizedSaleWhere: Prisma.POSSaleWhereInput = {
  status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "RETURNED"] },
};
export const recognizedSaleSQL = Prisma.sql`s.status IN ('COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED')`;

// A refunded cancellation still had a real receipt. Keep it in cash movement
// accounting so its refund offsets the receipt, including across sessions.
// Administrative voids without a refund have no retained payment effect.
export const receivedSaleWhere: Prisma.POSSaleWhereInput = {
  OR: [recognizedSaleWhere, { status: "CANCELLED", returns: { some: {} } }],
};
