import { Prisma } from "@prisma/client";
import { ensure } from "./validation";
const D = Prisma.Decimal;
export const round = (n: Prisma.Decimal) =>
  n.toDecimalPlaces(2, D.ROUND_HALF_UP);
export function lineTotals(
  price: Prisma.Decimal,
  quantity: number,
  discount: Prisma.Decimal,
  taxRate: Prisma.Decimal,
) {
  ensure(discount.gte(0) && discount.lte(price), "Discount exceeds unit price");
  const subtotal = price.mul(quantity),
    discountTotal = discount.mul(quantity);
  const taxable = subtotal.minus(discountTotal),
    taxTotal = round(taxable.mul(taxRate).div(100));
  return {
    subtotal,
    discountTotal,
    taxTotal,
    lineTotal: taxable.plus(taxTotal),
  };
}
// Cumulative allocation ensures successive partial returns refund exactly the original line total.
export function refundAllocation(
  lineTotal: Prisma.Decimal,
  quantity: number,
  alreadyReturned: number,
  returning: number,
) {
  ensure(
    returning > 0 && alreadyReturned + returning <= quantity,
    "Return exceeds eligible quantity",
  );
  return round(lineTotal.mul(alreadyReturned + returning).div(quantity)).minus(
    round(lineTotal.mul(alreadyReturned).div(quantity)),
  );
}
