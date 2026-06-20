import { prisma } from '../src/utils/db';

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        profile: {
          select: {
            fullName: true,
          }
        }
      }
    });
    console.log('--- USER ACCOUNTS ---');
    console.log(JSON.stringify(users, null, 2));
  } catch (e: any) {
    console.error('Error:', e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
