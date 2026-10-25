import { prisma } from '../src/utils/db';

async function main() {
  const tables: any[] = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema='public' AND table_type='BASE TABLE'
  `;
  console.log('Tables found:', tables.map(t => t.table_name).join(', '));

  console.log('\n--- Searching for BLAZO in all text columns ---');
  for (const { table_name } of tables) {
    try {
      const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='${table_name}' AND data_type IN ('text', 'character varying', 'json', 'jsonb')
      `);
      if (cols.length === 0) continue;
      const conditions = cols.map(c => `"${c.column_name}"::text ILIKE '%BLAZO%'`).join(' OR ');
      const res: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "${table_name}" WHERE ${conditions} LIMIT 5
      `);
      if (res.length > 0) {
        console.log(`Match in table ${table_name}: ${res.length} rows`);
        console.log(JSON.stringify(res, null, 2));
      }
    } catch (e: any) {
      // ignore
    }
  }

  console.log('\n--- Searching for 122 or HWM-122 in transactions / logs ---');
  for (const { table_name } of tables) {
    try {
      const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='${table_name}' AND data_type IN ('text', 'character varying', 'json', 'jsonb')
      `);
      if (cols.length === 0) continue;
      const conditions = cols.map(c => `"${c.column_name}"::text ILIKE '%HWM-122%' OR "${c.column_name}"::text ILIKE '%122%'`).join(' OR ');
      const res: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "${table_name}" WHERE ${conditions} LIMIT 5
      `);
      if (res.length > 0) {
        console.log(`Match in table ${table_name}: ${res.length} rows`);
        for (const row of res) {
          // Check if it really has 122 or HWM-122
          const str = JSON.stringify(row);
          if (str.includes('HWM-122') || str.includes('1895') || str.includes('bebc71a3')) {
            console.log('SPECIFIC MATCH in', table_name, str.substring(0, 1000));
          }
        }
      }
    } catch (e: any) {
      // ignore
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
