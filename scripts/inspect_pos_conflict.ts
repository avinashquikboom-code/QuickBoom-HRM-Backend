import {prisma} from '../src/utils/db';
async function main(){
 console.log(JSON.stringify({indexes:await prisma.$queryRaw`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE tablename IN ('POSSale','POSSaleItem','POSSession','POSRegister')`,sequence:await prisma.$queryRaw`SELECT last_value::text,is_called FROM "POSInvoiceSequence"`,invoices:await prisma.$queryRaw`SELECT COUNT(*)::text AS count,MAX("invoiceNo") AS latest FROM "POSSale"`,busyRegisters:await prisma.$queryRaw`SELECT COUNT(*)::text AS count FROM "POSSession" WHERE "closedAt" IS NULL`},null,2));
}main().finally(()=>prisma.$disconnect());
