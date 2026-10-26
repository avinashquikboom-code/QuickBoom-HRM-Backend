/** Controlled administrator reconciliation. Dry run by default; never invents catalog/rate records. */
import { prisma } from '../src/utils/db';
import { reconcilePendingInvoiceCommissions } from '../src/services/pendingInvoiceReconciliation';
async function main(){
 const args=process.argv.slice(2);let actorId:number|undefined;const ids:number[]=[];let apply=false;
 for(let i=0;i<args.length;i++){
   if(args[i]==='--actor-id') actorId=Number(args[++i]);
   else if(args[i]==='--transaction-id') ids.push(Number(args[++i]));
   else if(args[i]==='--apply') apply=true;
   else throw new Error('Usage: --actor-id ID [--transaction-id ID ...] [--apply]');
 }
 if(!Number.isSafeInteger(actorId)||!actorId||actorId<1) throw new Error('An existing administrator --actor-id is required');
 if(apply&&!ids.length) throw new Error('Apply requires explicit --transaction-id values reviewed in the preview');
 const result=await reconcilePendingInvoiceCommissions({actorId,dryRun:!apply,...(ids.length?{transactionIds:ids}:{})});
 console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
