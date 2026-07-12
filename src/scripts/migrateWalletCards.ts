/**
 * migrateWalletCards.ts
 * Updates existing wallet card numbers from old QB- format to new HK-{employeeCode}-{last4phone} format.
 * Run once: npx ts-node src/scripts/migrateWalletCards.ts
 */
import { prisma } from '../utils/db';

async function migrate() {
  console.log('=== Wallet Card Migration ===\n');

  const wallets = await prisma.wallet.findMany({
    include: { employee: true },
  });

  console.log(`Found ${wallets.length} wallets to check.`);
  let updated = 0;

  for (const wallet of wallets) {
    const emp = wallet.employee;
    if (!emp) continue;

    const last4Phone = emp.mobileNumber
      ? emp.mobileNumber.replace(/\D/g, '').slice(-4)
      : '0000';
    const newCard = `HK-${emp.employeeCode}-${last4Phone}`;

    if (wallet.cardNumber !== newCard) {
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: { cardNumber: newCard },
      });
      console.log(`  Updated wallet #${wallet.id} (${emp.employeeCode}): ${wallet.cardNumber} → ${newCard}`);
      updated++;
    }
  }

  console.log(`\n✅ Migration complete. Updated ${updated} wallet card numbers.`);
  await prisma.$disconnect();
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
