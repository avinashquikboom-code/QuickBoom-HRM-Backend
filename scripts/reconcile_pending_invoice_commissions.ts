/** Controlled administrator reconciliation. Dry run by default; never invents catalog/rate records. */
import { prisma } from '../src/utils/db';
import { reconcilePendingInvoiceCommissions } from '../src/services/pendingInvoiceReconciliation';
async function main(){
 const args=process.argv.slice(2);let actorId:number|undefined;const ids:number[]=[];const bills:string[]=[];let apply=false;
 for(let i=0;i<args.length;i++){
   if(args[i]==='--actor-id') actorId=Number(args[++i]);
   else if(args[i]==='--transaction-id') ids.push(Number(args[++i]));
   else if(args[i]==='--bill-id') {
     const bill=args[++i];if(!bill || !/^(?:HWM-|INV-)?[0-9]+$/i.test(bill)) throw new Error('Invalid --bill-id');
     bills.push(bill.replace(/^(?:HWM-|INV-)/i,''));
   }
   else if(args[i]==='--apply') apply=true;
   else throw new Error('Usage: --actor-id ID [--transaction-id ID ...] [--bill-id BILL ...] [--apply]');
 }
 if(!Number.isSafeInteger(actorId)||!actorId||actorId<1) throw new Error('An existing administrator --actor-id is required');
 if(bills.length) {
   const aliases=[...new Set(bills.flatMap(bill=>[bill,`HWM-${bill}`,`INV-${bill}`]))];
   const matches=await prisma.commissionTransaction.findMany({where:{status:'PENDING',eventType:{in:['INVOICE_CREATED','INVOICE_UPDATED']},OR:[{billId:{in:aliases}},{invoiceNumber:{in:aliases}}]},select:{id:true}});
   ids.push(...matches.map(row=>row.id));
   if(!matches.length) {console.log(JSON.stringify({dryRun:!apply,results:[],message:'No pending invoices matched; finalized records were not selected'}));return;}
 }
 if(apply&&!ids.length) throw new Error('Apply requires explicit --transaction-id values reviewed in the preview');
 const result=await reconcilePendingInvoiceCommissions({actorId,dryRun:!apply,...(ids.length?{transactionIds:ids}:{})});
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
