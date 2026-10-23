import { Prisma } from "@prisma/client";
export class POSError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new POSError(status, message);
}
export function object(value: unknown): Record<string, any> {
  ensure(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
  return value as Record<string, any>;
}
export function keys(value: Record<string, any>, allowed: string[]) {
  ensure(
    Object.keys(value).every((k) => allowed.includes(k)),
    "Unexpected request field",
  );
}
export function text(value: unknown, name: string, max = 200): string {
  ensure(
    typeof value === "string" && value!.trim().length > 0 && value!.length <= max,
    `Invalid ${name}`,
  );
  return value!.trim();
}

/** Optional string: absent, null or blank normalises to undefined; otherwise text(). */
export function optionalText(
  value: unknown,
  name: string,
  max = 200,
): string | undefined {
  if (value == null || (typeof value === "string" && value.trim() === ""))
    return undefined;
  return text(value, name, max);
}
export function uuid(value: unknown): string {
  const v = text(value, "UUID", 36);
  ensure(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "Invalid UUID",
  );
  return v;
}
export function integer(
  value: unknown,
  name = "quantity",
  min = 1,
  max = 1000000,
): number {
  ensure(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    `Invalid ${name}`,
  );
  return value;
}
export function money(
  value: unknown,
  name = "amount",
  max = "9999999999.99",
): Prisma.Decimal {
  ensure(
    (typeof value === "string" || typeof value === "number") &&
      /^\d{1,10}(\.\d{1,2})?$/.test(String(value)),
    `Invalid ${name}: use nonnegative decimal with at most two places`,
  );
  const d = new Prisma.Decimal(value);
  ensure(d.lte(max), `${name} exceeds limit`);
  return d;
}
export function list(value: unknown, max = 100): any[] {
  ensure(
    Array.isArray(value) && value.length > 0 && value.length <= max,
    "Expected a nonempty bounded list",
  );
  return value;
}
export function unique(values: string[]) {
  ensure(new Set(values).size === values.length, "Duplicate line item");
}
export const methods = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"];
export function method(value: unknown): string {
  ensure(
    typeof value === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(value),
    "Invalid payment method",
  );
  return value;
}
export function boolean(value: unknown): boolean {
  ensure(typeof value === "boolean", "Expected boolean");
  return value;
}
export function page(query: Record<string, any>) {
  const n = Number(query.page ?? 1),
    size = Number(query.pageSize ?? 30);
  integer(n, "page", 1, 100000);
  integer(size, "pageSize", 1, 100);
  return { skip: (n - 1) * size, take: size, page: n };
}
export function dateRange(query: Record<string, any>) {
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const from = query.from ?? today,
    to = query.to ?? today;
  for (const d of [from, to])
    ensure(
      typeof d === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(d) &&
        !Number.isNaN(Date.parse(d)) &&
        new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d,
      "Invalid date",
    );
  const gte = new Date(`${from}T00:00:00+05:30`),
    lt = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000);
  ensure(
    lt > gte && lt.getTime() - gte.getTime() <= 366 * 86400000,
    "Date range must be between 1 and 366 days",
  );
  return { gte, lt };
}
