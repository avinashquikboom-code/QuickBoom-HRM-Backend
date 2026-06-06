const bcrypt = require('bcrypt');

// Test password verification directly
async function testPasswordHash() {
  try {
    const testPassword = '123456';
    
    // Hash the password like in seed
    const passwordHash = await bcrypt.hash('123456', 10);
    console.log('✅ Generated hash:', passwordHash);
    
    // Test verification
    const isMatch = await bcrypt.compare(testPassword, passwordHash);
    console.log('✅ Password verification result:', isMatch);
    
    // Test with the actual hash from seed
    const seedHash = '$2b$10$N9qo8uLOickgx2ZMRZoMy.Mrq7sjLw4a5d8X8C1Q.k0j.2b.3.4.5'; // Example format
    console.log('🔑 Testing with seed-like hash format...');
    
  } catch (error) {
    console.error('❌ Error testing password:', error);
  }
}

testPasswordHash();
