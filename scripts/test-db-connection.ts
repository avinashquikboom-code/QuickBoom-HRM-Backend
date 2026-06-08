
import { prisma } from '../utils/db';

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection successful');
    
    // Test user table
    const userCount = await prisma.user.count();
    console.log(`✅ User table accessible: ${userCount} users found`);
    
    // Test FCMToken table (this might cause the error)
    try {
      const fcmCount = await prisma.fCMToken.count();
      console.log(`✅ FCMToken table accessible: ${fcmCount} tokens found`);
    } catch (fcmError) {
      console.error('❌ FCMToken table error:', fcmError.message);
      console.log('🔧 This is likely causing the authentication issue');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

testDatabaseConnection();
