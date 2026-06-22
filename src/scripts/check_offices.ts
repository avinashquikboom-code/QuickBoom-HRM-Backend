import 'dotenv/config';
import { prisma } from '../utils/db';

async function main() {
  console.log("Fetching all offices...");
  const offices = await prisma.office.findMany({});
  console.log(`Total offices: ${offices.length}`);
  for (const o of offices) {
    console.log(`- ID: ${o.id}, Name: "${o.name}", Code: "${o.code}", Lat: ${o.latitude}, Lng: ${o.longitude}, Max Radius: ${o.maxPunchRadiusMeters}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
