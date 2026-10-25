import { prisma } from '../src/utils/db';

async function main() {
  const tables: any[] = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema='public' AND table_type='BASE TABLE'
  `;

  console.log('\n--- Searching for HWM in all text columns ---');
  for (const { table_name } of tables) {
    try {
      const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='${table_name}' AND data_type IN ('text', 'character varying', 'json', 'jsonb')
      `);
      if (cols.length === 0) continue;
      const conditions = cols.map(c => `"${c.column_name}"::text ILIKE '%HWM%'`).join(' OR ');
      const res: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "${table_name}" WHERE ${conditions} LIMIT 5
      `);
      if (res.length > 0) {
        console.log(`Match in table ${table_name}: ${res.length} rows`);
        for (const row of res) {
          console.log(JSON.stringify(row).substring(0, 500));
        }
      }
    } catch (e: any) {
      // ignore
    }
  }

  console.log('\n--- Searching for 1895 in all numeric/text columns ---');
  for (const { table_name } of tables) {
    try {
      const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='${table_name}'
      `);
      if (cols.length === 0) continue;
      const conditions = cols.map(c => `"${c.column_name}"::text ILIKE '%1895%'`).join(' OR ');
      const res: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "${table_name}" WHERE ${conditions} LIMIT 5
      `);
      if (res.length > 0) {
        console.log(`Match for 1895 in table ${table_name}: ${res.length} rows`);
        for (const row of res) {
          console.log(JSON.stringify(row).substring(0, 500));
        }
      }
    } catch (e: any) {
      // ignore
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
