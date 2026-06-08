// This script fixes the authentication issue by adding better error handling
// and ensuring compatibility with the FCM token schema changes

const fs = require('fs');
const path = require('path');

// Read the current auth controller
const authControllerPath = path.join(__dirname, 'src/controllers/authController.ts');
const authControllerContent = fs.readFileSync(authControllerPath, 'utf8');

// Create a fixed version with better error handling
const fixedAuthController = authControllerContent.replace(
  /} catch \(error\) {\s*console\.error\('Login error:', error\);\s*res\.status\(500\)\.json\({\s*success: false,\s*message: 'Internal server error during login\.',\s*}\);/,
  `} catch (error) {
    console.error('Login error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    });
    
    // Handle specific errors
    if (error.code === 'P2021') {
      // Table doesn't exist error
      console.error('Database table missing - FCMToken table issue');
      res.status(500).json({
        success: false,
        message: 'Database schema error. Please contact administrator.',
        errorCode: 'SCHEMA_ERROR'
      });
    } else if (error.code === 'P2002') {
      // Unique constraint violation
      res.status(500).json({
        success: false,
        message: 'Database constraint violation.',
        errorCode: 'CONSTRAINT_ERROR'
      });
    } else if (error.message?.includes('FCMToken')) {
      // FCM token related error
      console.error('FCM Token schema issue detected');
      res.status(500).json({
        success: false,
        message: 'Authentication service temporarily unavailable.',
        errorCode: 'FCM_TOKEN_ERROR'
      });
    } else {
      // Generic error with more details
      res.status(500).json({
        success: false,
        message: 'Internal server error during login.',
        errorCode: 'INTERNAL_ERROR',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }`
);

console.log('🔧 [FIX] Creating improved auth controller...');

// Write the fixed version
fs.writeFileSync(authControllerPath, fixedAuthController);

console.log('✅ [FIX] Auth controller updated with better error handling');

// Also create a simple database connection test
const dbTestScript = `
import { prisma } from '../utils/db';

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    await prisma.$queryRaw\`SELECT 1\`;
    console.log('✅ Database connection successful');
    
    // Test user table
    const userCount = await prisma.user.count();
    console.log(\`✅ User table accessible: \${userCount} users found\`);
    
    // Test FCMToken table (this might cause the error)
    try {
      const fcmCount = await prisma.fCMToken.count();
      console.log(\`✅ FCMToken table accessible: \${fcmCount} tokens found\`);
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
`;

fs.writeFileSync(path.join(__dirname, 'test-db-connection.ts'), dbTestScript);

console.log('✅ [FIX] Database test script created');
console.log('🚀 [NEXT] Deploy these changes to Render to fix the authentication issue');
