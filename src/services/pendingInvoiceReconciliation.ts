import { prisma } from '../utils/db';
import { prepareInvoiceApproval, isExternalInvoice } from './invoiceCommissionService';
import { updateEmployeeWalletCommission, broadcastCommissionEvent } from '../utils/commissionHelper';

/** Explicit administrator operation. Preview by default; approved/paid history is never selected. */
export async function reconcilePendingInvoiceCommissions(options: {
  actorId: number; dryRun?: boolean; transactionIds?: number[]; limit?: number;
}) {
  const actor = await prisma.user.findUnique({where:{id:options.actorId},select:{role:true}});
  if (!actor || !['ADMIN','SUPERADMIN','PLATFORMADMIN'].includes(actor.role.toUpperCase().replace(/_/g,''))) {
    throw Object.assign(new Error('Administrator required for invoice reconciliation'),{status:403});
  }
  const dryRun=options.dryRun!==false;
  const ids=options.transactionIds;
  if(ids && (!ids.length || ids.length>100 || ids.some(id=>!Number.isSafeInteger(id)||id<=0))) throw Object.assign(new Error('Invalid transaction IDs'),{status:400});
  if(!dryRun&&!ids?.length) throw Object.assign(new Error('Apply requires reviewed transaction IDs'),{status:400});
  const limit=options.limit??100;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw Object.assign(new Error('Limit must be 1 to 100'),{status:400});
  const candidates=await prisma.commissionTransaction.findMany({where:{status:'PENDING',eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']},...(ids?{id:{in:ids}}:{})},select:{id:true},orderBy:{id:'asc'},take:limit});
  const results=[];
  for(const candidate of candidates) {
    try {
      const result=await prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "CommissionTransaction" WHERE id=${candidate.id} FOR UPDATE`;
        const sale=await tx.commissionTransaction.findUniqueOrThrow({where:{id:candidate.id}});
        if(sale.status!=='PENDING'||!isExternalInvoice(sale)) return {id:sale.id,state:'SKIPPED'};
        const resolved=await prepareInvoiceApproval(tx,sale);
        const amount=resolved.commissionAmount;
        if(amount==null) throw new Error('Invoice lacks verified product mapping, rate, or eligible-sale data');
        if(dryRun) return {id:sale.id,invoiceNumber:sale.invoiceNumber,state:'READY',commissionAmount:amount};
        const updated=await tx.commissionTransaction.update({where:{id:sale.id},data:{...resolved,status:'APPROVED',approvedBy:options.actorId,approvedAt:new Date(),oldCommission:sale.commissionAmount,commissionDifference:amount-sale.commissionAmount}});
        const delta=Math.round((amount-sale.commissionAmount)*100)/100;
        if(delta!==0) await updateEmployeeWalletCommission(sale.employeeId,Math.abs(delta),delta>0,
          `Commission reconciliation - ${sale.invoiceNumber??sale.billId??sale.id}`,
          delta>0?'Commission Earned':'Commission Reversed',tx);
        await tx.commissionHistory.create({data:{transactionId:sale.id,employeeId:sale.employeeId,action:'APPROVED',previousStatus:'PENDING',newStatus:'APPROVED',previousAmount:sale.commissionAmount,newAmount:amount,performedBy:options.actorId,reason:'Controlled reconciliation from verified effective-dated subcategory configuration'}});
        await tx.hrmCommissionAudit.create({data:{userId:options.actorId,action:'PENDING_INVOICE_RECONCILED',data:{transactionId:sale.id,previousAmount:sale.commissionAmount,commissionAmount:amount,delta}}});
        return {id:sale.id,invoiceNumber:sale.invoiceNumber,state:'RECONCILED',commissionAmount:amount,employeeId:updated.employeeId};
      },{timeout:30000});
      results.push(result);
      if(result.state==='RECONCILED'&&'employeeId' in result) await broadcastCommissionEvent(result.employeeId!,{type:'COMMISSION_RECONCILED',transactionId:result.id});
    } catch(error:any) { results.push({id:candidate.id,state:'BLOCKED',message:error.message}); }
  }
  return {dryRun,results};
}
