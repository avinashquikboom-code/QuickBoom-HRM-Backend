import { prisma } from '../src/utils/db';
import { initializeStorePOSCredentials } from '../src/pos/storeCredentials';
const dryRun=process.argv.includes('--dry-run');
initializeStorePOSCredentials(dryRun).then(result=>console.log(JSON.stringify(result))).then(()=>prisma.$disconnect()).then(()=>process.exit(0)).catch(async()=>{console.error('POS initialization failed. Verify database connectivity and apply the POS credential migration first. No existing credential is overwritten; rerunning is safe.');await prisma.$disconnect();process.exit(1);});
