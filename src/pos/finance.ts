import { Prisma } from "@prisma/client";
import { ensure } from "./validation";
const D = Prisma.Decimal;
export const round = (n: Prisma.Decimal) =>
  n.toDecimalPlaces(2, D.ROUND_HALF_UP);
export type DiscountType = "amount" | "percent";
export function discountInput(value: unknown, type: unknown = "amount") {
  ensure(type === "amount" || type === "percent", "Invalid discount type");
  const raw = value === undefined ? "0" : typeof value === "string" ? value.trim() || "0" : String(value);
  ensure((typeof value === "string" || typeof value === "number" || value === undefined) &&
    /^(?:\d{1,10}(?:\.\d{0,20})?|\.\d{1,20})(?:e[+-]?\d{1,2})?$/i.test(raw), "Discount must be a nonnegative decimal");
  const amount = new D(raw);
  ensure(amount.isFinite() && amount.gte(0), "Discount cannot be negative");
  ensure(type !== "percent" || amount.lte(100), "Discount must be between 0% and 100%");
  return { value: amount, type: type as DiscountType };
}
export function lineTotals(price: Prisma.Decimal, quantity: number, discount: Prisma.Decimal,
  taxRate: Prisma.Decimal, type: DiscountType = "amount") {
  ensure(price.isFinite() && price.gt(0), "Unit price must be greater than zero");
  ensure(Number.isSafeInteger(quantity) && quantity > 0, "Invalid quantity");
  ensure(taxRate.isFinite() && taxRate.gte(0) && taxRate.lte(100), "Invalid GST rate");
  ensure(discount.isFinite() && discount.gte(0) && discount.lte(type === "percent" ? 100 : price),
    type === "percent" ? "Discount must be between 0% and 100%" : "Discount exceeds unit price");
  const subtotal = round(price.mul(quantity));
  const discountTotal = type === "percent" ? round(subtotal.mul(discount).div(100)) : round(discount.mul(quantity));
  const taxable = subtotal.minus(discountTotal), taxTotal = round(taxable.mul(taxRate).div(100));
  return { subtotal, discountTotal, taxTotal, lineTotal: taxable.plus(taxTotal) };
}
/** One canonical quote/checkout calculation; the UI displays these snapshots. */
export function billTotals(lines: { price: Prisma.Decimal; quantity: number; discount: Prisma.Decimal;
  taxRate: Prisma.Decimal; discountType?: DiscountType; eligible?: boolean }[],
  orderDiscount = new D(0), orderDiscountType: DiscountType = "amount") {
  const initial = lines.map(l => lineTotals(l.price, l.quantity, l.discount, l.taxRate, l.discountType));
  const eligible = initial.reduce((n, t, i) => lines[i].eligible === false ? n : n.plus(t.subtotal.minus(t.discountTotal)), new D(0));
  ensure(orderDiscount.gte(0) && orderDiscount.lte(orderDiscountType === "percent" ? 100 : eligible), "Order discount exceeds eligible taxable amount");
  const orderDiscountTotal = orderDiscountType === "percent" ? round(eligible.mul(orderDiscount).div(100)) : round(orderDiscount);
  let remaining = orderDiscountTotal, baseLeft = eligible;
  const snapshots = initial.map((t, i) => {
    const base = t.subtotal.minus(t.discountTotal);
    let allocation = new D(0);
    if (lines[i].eligible !== false && baseLeft.gt(0)) {
      allocation = base.equals(baseLeft) ? remaining : D.min(base, round(remaining.mul(base).div(baseLeft)));
      remaining = remaining.minus(allocation); baseLeft = baseLeft.minus(base);
    }
    const discountTotal = t.discountTotal.plus(allocation), taxable = t.subtotal.minus(discountTotal);
    const taxTotal = round(taxable.mul(lines[i].taxRate).div(100));
    return { ...t, itemDiscountTotal: t.discountTotal, orderDiscountTotal: allocation, discountTotal, taxTotal, lineTotal: taxable.plus(taxTotal) };
  });
  ensure(remaining.isZero(), "Could not allocate order discount");
  const sum = (field: "subtotal" | "discountTotal" | "taxTotal" | "lineTotal" | "itemDiscountTotal") => snapshots.reduce((n,t) => n.plus(t[field]), new D(0));
  return { snapshots, subtotal: sum("subtotal"), discountTotal: sum("discountTotal"), taxTotal: sum("taxTotal"),
    grandTotal: sum("lineTotal"), itemDiscountTotal: sum("itemDiscountTotal"), orderDiscountTotal };
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

/** Allocate tax and taxable revenue separately, so a partial credit never has negative tax. */
export function refundComponents(
  lineTotal: Prisma.Decimal,
  taxTotal: Prisma.Decimal,
  quantity: number,
  alreadyReturned: number,
  returning: number,
) {
  const revenueRefund = refundAllocation(
    lineTotal.minus(taxTotal),
    quantity,
    alreadyReturned,
    returning,
  );
  const taxRefund = refundAllocation(
    taxTotal,
    quantity,
    alreadyReturned,
    returning,
  );
  return {
    revenueRefund,
    taxRefund,
    refundAmount: revenueRefund.plus(taxRefund),
  };
}
