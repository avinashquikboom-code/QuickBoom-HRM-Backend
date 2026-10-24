import { Prisma } from "@prisma/client";
import { Response } from "express";
import ExcelJS from "exceljs";
import { prisma } from "../utils/db";
import { Actor, permission, scope } from "./auth";
import { ensure, object, keys, integer, uuid, dateRange } from "./validation";

export const invoiceInclude = {
  store: { select: { id: true, name: true, address: true } },
  cashier: { select: { email: true, profile: { select: { fullName: true } } } },
  salesperson: { select: { firstName: true, lastName: true } },
  items: { include: { salesperson: { select: { firstName: true, lastName: true } } } },
  payments: { select: { method: true, amount: true } },
} satisfies Prisma.POSSaleInclude;
export type Invoice = Prisma.POSSaleGetPayload<{ include: typeof invoiceInclude }>;
const statuses = ["ALL", "COMPLETED", "CANCELLED", "PARTIALLY_RETURNED", "RETURNED"];
const formats = ["pdf", "csv", "xlsx"];
export function exportFilter(actor: Actor, input: unknown) {
  permission(actor, "read");
  const b = object(input);
  keys(b, ["storeId", "from", "to", "status", "paymentMode", "saleIds", "format", "detailed", "paper", "search", "employeeId"]);
  const storeId = integer(b.storeId, "storeId");
  scope(actor, storeId); // Deliberately require one explicit store, even for administrators.
  const status = b.status ?? "ALL", payment = b.paymentMode ?? "ALL", format = b.format ?? "pdf";
  ensure(statuses.includes(status), "Unsupported bill status");
  ensure(["ALL", "CASH", "CARD", "UPI"].includes(payment), "Unsupported payment mode");
  ensure(formats.includes(format), "Unsupported export format");
  ensure(b.detailed === undefined || typeof b.detailed === "boolean", "Invalid detailed flag");
  ensure(["A4", "80", "58"].includes(b.paper ?? "A4"), "Unsupported PDF paper size");
  let ids: string[] | undefined;
  if (b.saleIds !== undefined) {
    ensure(Array.isArray(b.saleIds) && b.saleIds.length > 0 && b.saleIds.length <= 1000,
      "Select between 1 and 1000 bills");
    ids = [...new Set<string>(b.saleIds.map((id: unknown) => uuid(id)))];
  }
  ensure((b.from === undefined) === (b.to === undefined), "Specify both date boundaries");
  const search = b.search ?? "";
  ensure(typeof search === "string" && search.length <= 200, "Invalid invoice search");
  const employeeId = b.employeeId ? integer(Number(b.employeeId), "employeeId") : undefined;
  const where: Prisma.POSSaleWhereInput = {
    storeId, AND: [
      ...(search ? [{ OR: [{ invoiceNo: { contains: search, mode: "insensitive" as const } },
        { customerName: { contains: search, mode: "insensitive" as const } }, { customerPhone: { contains: search, mode: "insensitive" as const } },
        { items: { some: { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { sku: { contains: search, mode: "insensitive" as const } }, { barcode: { contains: search, mode: "insensitive" as const } }] } } }] }] : []),
      ...(employeeId ? [{ OR: [{ salespersonId: employeeId }, { items: { some: { salespersonId: employeeId } } }] }] : []),
    ], ...(ids ? { id: { in: ids } } : {}),
    ...(b.from !== undefined ? { createdAt: (() => {
      const start = dateRange({ from: b.from, to: b.from }).gte;
      const end = dateRange({ from: b.to, to: b.to }).lt;
      ensure(end > start, "Invalid date range: end date must follow start date");
      return { gte: start, lt: end };
    })() } : {}),
    ...(status !== "ALL" ? { status } : {}),
    ...(payment !== "ALL" ? { payments: { some: { method: payment } } } : {}),
  };
  return { where, storeId, ids, format: format as string, detailed: b.detailed === true, paper: b.paper ?? "A4" };
}
async function matching(tx: Prisma.TransactionClient, filter: ReturnType<typeof exportFilter>) {
  const count = await tx.pOSSale.count({ where: filter.where });
  ensure(!filter.ids || count === filter.ids.length,
    "Some selected bills are unavailable or do not match this store and filters", 400);
  return count;
}
export async function previewBillExport(actor: Actor, input: unknown) {
  const filter = exportFilter(actor, input);
  return { count: await matching(prisma, filter), storeId: filter.storeId };
}
const person = (p?: { firstName: string; lastName: string | null } | null) => p ? `${p.firstName} ${p.lastName ?? ""}`.trim() : "";
const date = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
export const exportHeaders = ["Invoice number", "Date and time (IST)", "Store", "Customer", "Cashier", "Salesperson", "Item count", "Subtotal", "Discount", "GST/tax", "Total amount", "Payment mode", "Payment breakdown", "Status"];
const itemHeaders = ["Product", "Barcode/SKU", "Quantity", "Unit price", "Item discount", "Item GST", "Line total", "Item salesperson"];
export function invoiceRow(s: Invoice): (string | number)[] {
  return [s.invoiceNo, date(s.createdAt), s.store.name, s.customerName ?? "Walk-in Customer",
    s.cashier.profile?.fullName || s.cashier.email || "", person(s.salesperson) || [...new Set(s.items.map(i => person(i.salesperson)).filter(Boolean))].join("; "),
    s.items.reduce((n, i) => n + i.quantity, 0), s.subtotal.toFixed(2), s.discountTotal.toFixed(2),
    s.taxTotal.toFixed(2), s.grandTotal.toFixed(2), [...new Set(s.payments.map(p => p.method))].join(" + "),
    s.payments.map(p => `${p.method}: ${p.amount.toFixed(2)}`).join("; "), s.status];
}
function rows(s: Invoice, detailed: boolean) {
  const base = invoiceRow(s);
  return detailed ? s.items.map(i => [...base, i.name, i.barcode || i.sku, i.quantity, i.unitPrice.toFixed(2),
    i.discountTotal.toFixed(2), i.taxTotal.toFixed(2), i.lineTotal.toFixed(2), person(i.salesperson)]) : [base];
}
export function csvCell(value: string | number) {
  // Protect spreadsheets from formula injection through customer/product/store text.
  let s = String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
async function write(res: Response, data: string) {
  ensure(!res.destroyed, "Export download disconnected", 499);
  if (!res.write(data)) await new Promise<void>((resolve, reject) => {
    const clean = () => { res.off("drain", drained); res.off("close", closed); res.off("error", failed); };
    const drained = () => { clean(); resolve(); };
    const closed = () => { clean(); reject(new Error("Export download disconnected")); };
    const failed = (error: Error) => { clean(); reject(error); };
    res.once("drain", drained); res.once("close", closed); res.once("error", failed);
  });
}

/** Uses pdfmake's bundled PDFKit and Unicode fonts; no extra PDF dependency. */
export function invoicePdf(invoices: Invoice[], paper: string = "A4"): Promise<Buffer> {
  const PDFDocument = require("@foliojs-fork/pdfkit");
  const bundle = require("pdfmake/build/vfs_fonts.js");
  const vfs = bundle.pdfMake?.vfs || bundle.vfs || bundle;
  const doc = new PDFDocument({ autoFirstPage: false, compress: true, info: { Title: "HopKid POS invoices", Author: "HopKid" } });
  doc.registerFont("Regular", Buffer.from(vfs["Roboto-Regular.ttf"], "base64"));
  doc.registerFont("Bold", Buffer.from(vfs["Roboto-Medium.ttf"], "base64"));
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b: Buffer) => chunks.push(b)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  });
  const width = paper === "A4" ? 595.28 : Number(paper) * 72 / 25.4;
  const margin = paper === "A4" ? 42 : 10, contentWidth = width - margin * 2;
  const fontSize = paper === "58" ? 8 : paper === "80" ? 9 : 11;
  type Line = { text: string; bold?: boolean; center?: boolean; size?: number; gap?: number; barcode?: boolean; logo?: boolean; itemStart?: boolean; summaryStart?: boolean };
  for (const s of invoices) {
    const lines: Line[] = [
      { text: "hopkid", logo: true, bold: true, center: true, size: paper === "A4" ? 42 : 28 },
      { text: "FASHION FOR LITTLE ONES", center: true, size: fontSize - 1 },
      { text: `Multi Store - ${s.store.name}`, bold: true, center: true },
      ...(s.store.address ? [{ text: s.store.address, center: true }] : []),
      { text: `Bill No: ${s.invoiceNo}`, bold: true, gap: 8 },
      { text: `Date / Time: ${date(s.createdAt)}` },
      { text: `Status: ${s.status}`, bold: true },
      { text: `Cashier: ${s.cashier.profile?.fullName || s.cashier.email || "Unassigned"}` },
      { text: `Salesperson: ${person(s.salesperson) || [...new Set(s.items.map(i => person(i.salesperson)).filter(Boolean))].join(", ") || "Unassigned"}` },
      { text: `Customer: ${s.customerName || "Walk-in Customer"}${s.customerPhone ? ` | ${s.customerPhone}` : ""}`, gap: 6 },
    ];
    s.items.forEach((i, index) => lines.push(
      { text: `${index + 1}. ${i.name}`, bold: true, gap: 6, itemStart: true },
      { text: `Barcode / SKU: ${i.barcode || i.sku || "Manual item"}` },
      { text: `Qty: ${i.quantity}   Unit price: ₹ ${i.unitPrice.toFixed(2)}` },
      { text: `Discount: ₹ ${i.discountTotal.toFixed(2)}   GST: ₹ ${i.taxTotal.toFixed(2)}` },
      { text: `Total: ₹ ${i.lineTotal.toFixed(2)}${i.salesperson ? ` | ${person(i.salesperson)}` : ""}`, bold: true },
    ));
    lines.push(
      { text: `Total items: ${s.items.reduce((n, i) => n + i.quantity, 0)}`, gap: 8, summaryStart: true },
      { text: `Sub Total: ₹ ${s.subtotal.toFixed(2)}` },
      { text: `Discount: ₹ ${s.discountTotal.toFixed(2)}` },
      { text: `Tax (GST): ₹ ${s.taxTotal.toFixed(2)}` },
      ...(Number(s.rounding) ? [{ text: `Rounding: ₹ ${s.rounding.toFixed(2)}` }] : []),
      { text: `Total Amount: ₹ ${s.grandTotal.toFixed(2)}`, bold: true, gap: 4, size: fontSize + 2 },
      { text: "Payment Mode", bold: true, gap: 8 },
      ...s.payments.map(p => ({ text: `${p.method}: ₹ ${p.amount.toFixed(2)}` })),
      { text: "Thank You for Shopping with us!", center: true, bold: true, gap: 12 },
      { text: "Visit Again", center: true },
      { text: "", barcode: true, gap: 8 },
      { text: s.invoiceNo, center: true, size: fontSize - 1 },
    );
    // Measure every line using the embedded font, including wrapped names.
    const measured = lines.map(line => {
      doc.font(line.bold ? "Bold" : "Regular").fontSize(line.size ?? fontSize);
      return { ...line, height: (line.barcode ? 40 : doc.heightOfString(line.text, { width: contentWidth })) + (line.logo ? 12 : 4) + (line.gap ?? 0) };
    });
    const height = paper === "A4" ? 841.89 : Math.min(14000, margin * 2 + measured.reduce((n, l) => n + l.height, 0));
    const addPage = () => doc.addPage({ size: [width, height], margins: { top: margin, bottom: margin, left: margin, right: margin } });
    addPage(); let y = margin;
    const continuation = () => {
      addPage(); y = margin;
      doc.font("Bold").fontSize(fontSize).text(`${s.invoiceNo} - continued`, margin, y, { width: contentWidth });
      y += doc.heightOfString(`${s.invoiceNo} - continued`, { width: contentWidth }) + 10;
    };
    for (let index = 0; index < measured.length; index++) {
      const line = measured[index];
      const blockHeight = line.summaryStart ? measured.slice(index).reduce((n, l) => n + l.height, 0)
        : line.itemStart ? measured.slice(index, index + 5).reduce((n, l) => n + l.height, 0) : line.height;
      if (y + blockHeight > height - margin && y > margin && blockHeight < height - margin * 2) continuation();
      if (y + line.height > height - margin && y > margin) continuation();
      y += line.gap ?? 0;
      if (line.barcode) {
        const barcode: { encodings?: { data: string }[] } = {};
        require("jsbarcode")(barcode, s.invoiceNo, { format: "CODE128", displayValue: false, margin: 0 });
        const bars = barcode.encodings!.map(e => e.data).join("");
        const barcodeWidth = Math.min(contentWidth - 12, 230);
        const unit = barcodeWidth / bars.length;
        for (let j = 0; j < bars.length; j++) if (bars[j] === "1") doc.rect((width - barcodeWidth) / 2 + j * unit, y, unit, 36).fill("black");
      } else {
        doc.font(line.bold ? "Bold" : "Regular").fontSize(line.size ?? fontSize)
          .text(line.text, margin, y, { width: contentWidth, align: line.center ? "center" : "left" });
        if (line.logo) {
          const center = width / 2, baseline = y + (line.size ?? fontSize) + 3;
          doc.moveTo(center + 3, baseline).bezierCurveTo(center + 9, baseline + 8, center + 19, baseline + 8, center + 25, baseline)
            .lineWidth(2).stroke("black");
        }
      }
      y += line.height - (line.gap ?? 0);
    }
  }
  doc.end(); return result;
}

export async function downloadBillExport(actor: Actor, input: unknown, res: Response) {
  const filter = exportFilter(actor, input);
  await prisma.$transaction(async tx => {
    const count = await matching(tx, filter);
    ensure(count > 0, "No bills match the selected filters", 404);
    ensure(filter.format !== "pdf" || count <= 500, "PDF exports support up to 500 bills. Narrow the filters or use CSV/Excel.", 413);
    const headers = [...exportHeaders, ...(filter.detailed ? itemHeaders : [])];
    let workbook: ExcelJS.stream.xlsx.WorkbookWriter | undefined;
    let sheet: ExcelJS.Worksheet | undefined;
    let sheetRows = 1, sheetNumber = 1;
    let cursor: string | undefined;
    const invoices: Invoice[] = [];
    let started = false;
    while (true) {
      const batch = await tx.pOSSale.findMany({ where: filter.where, include: invoiceInclude,
        orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!batch.length) break;
      if (!started) {
        const filename = count === 1 ? batch[0].invoiceNo.replace(/[^a-zA-Z0-9_-]/g, "-") : `HopKid-store-${filter.storeId}-bills`;
        res.setHeader("Content-Type", filter.format === "pdf" ? "application/pdf" : filter.format === "xlsx" ?
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.${filter.format}"`);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Export-Count");
        res.setHeader("X-Export-Count", count);
        if (filter.format === "csv") await write(res, "\uFEFF" + headers.map(csvCell).join(",") + "\r\n");
        if (filter.format === "xlsx") workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false });
        if (workbook) { sheet = workbook.addWorksheet(filter.detailed ? "Invoice items" : "Invoices"); sheet.addRow(headers).commit(); }
        started = true;
      }
      if (filter.format === "pdf") invoices.push(...batch);
      else for (const sale of batch) for (const row of rows(sale, filter.detailed)) {
        if (sheet && workbook) {
          if (sheetRows >= 1000000) {
            sheet.commit(); sheet = workbook.addWorksheet(`Invoices ${++sheetNumber}`);
            sheet.addRow(headers).commit(); sheetRows = 1;
          }
          sheet.addRow(row).commit(); sheetRows++;
        }
        else await write(res, row.map(csvCell).join(",") + "\r\n");
      }
      cursor = batch[batch.length - 1].id;
      if (res.destroyed) throw new Error("Download disconnected");
    }
    if (filter.format === "pdf") res.end(await invoicePdf(invoices, filter.paper));
    else if (workbook) { sheet!.commit(); await workbook.commit(); }
    else res.end();
  }, { isolationLevel: "RepeatableRead", timeout: 120000 });
}
