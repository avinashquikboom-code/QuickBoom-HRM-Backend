/** Read-only diagnostic. Prints only invoice/product configuration fields, no credentials or customer data. */
import { prisma } from '../src/utils/db';
import { findInvoicePayload } from '../src/services/invoiceCommissionService';
import { extractWebhookMeta } from '../src/utils/commissionHelper';
import { extractProductLineMeta } from '../src/utils/productLineMeta';
async function main() {
  const reference=process.argv[2]??'124';
  const aliases=[reference,...(/^\d+$/.test(reference)?[`HWM-${reference}`]:[])];
  const result=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const sales=await tx.commissionTransaction.findMany({where:{OR:[{billId:{in:aliases}},{invoiceNumber:{in:aliases}}]},select:{id:true,billId:true,invoiceNumber:true,storeId:true,status:true,saleAmount:true,commissionAmount:true,createdAt:true,productBreakdown:true}});
    const output=[];
    for(const sale of sales){
      const payload=await findInvoicePayload(tx,[...aliases,sale.billId??'',sale.invoiceNumber??''],sale.storeId);
      const rawItems=payload?extractWebhookMeta(payload.raw).lineItems:[];
      const saved=Array.isArray(sale.productBreakdown)?sale.productBreakdown:[];
      const lines=[...rawItems??[],...saved].filter((x:any)=>x&&typeof x==='object').map((item:any)=>{const meta=extractProductLineMeta(item);return {productID:meta.productId,productName:meta.productName,sku:meta.sku,variantId:item.variantId??null,subcategoryId:item.subcategoryId??null,subcategoryExternalId:item.subcategoryExternalId??null,subcategoryName:item.subcategoryName??null,quantity:item.quantity??item.qty??null,eligibleSaleAmount:item.eligibleSaleAmount??null,basis:item.basis??null,missingReason:item.missingReason??null};});
      const ids=[...new Set(lines.map(line=>String(line.productID??'')).filter(Boolean))];
      const uuidIds=ids.filter(id=>/^[0-9a-f-]{36}$/i.test(id));
      const products=uuidIds.length?await tx.pOSProduct.findMany({where:{id:{in:uuidIds}},select:{id:true,name:true,categoryId:true,category:{select:{id:true,name:true,parentId:true}}}}):[];
      const mappings=await tx.hrmCommissionMapping.findMany({where:{productId:{in:ids}},orderBy:{effectiveFrom:'desc'}});
      const subIds=[...new Set([...mappings.map(m=>m.subcategoryId),...lines.map(l=>String(l.subcategoryId??'')).filter(id=>/^[0-9a-f-]{36}$/i.test(id))])];
      const externalIds=lines.map(l=>String(l.subcategoryExternalId??l.subcategoryId??'')).filter(Boolean);
      const subcategories=await tx.hrmCommissionSubcategory.findMany({where:{OR:[{id:{in:subIds}},{externalId:{in:externalIds}}]}});
      const rates=await tx.hrmCommissionRate.findMany({where:{subcategoryId:{in:subcategories.map(sub=>sub.id)},storeKey:{in:[0,sale.storeId??0]}},orderBy:{effectiveFrom:'desc'}});
      const {productBreakdown,...summary}=sale;
      output.push({invoice:summary,hasOriginalPayload:!!payload,sourceLineCount:rawItems?.length??0,savedLineCount:saved.length,lines,products,mappings,subcategories,rates});
    }
    return {reference,found:sales.length>0,invoices:output};
  },{timeout:30000});
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error('Invoice diagnostic failed:',error.code??error.name);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
