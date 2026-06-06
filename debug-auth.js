const axios = require('axios');

async function testAuthEndpoints() {
  console.log('🔍 [DEBUG] Testing authentication endpoints...');

  const baseURL = 'https://quickboom-hrm-backend.onrender.com';
  
  try {
    // Test 1: Check if server is running
    console.log('\n📡 [TEST 1] Checking server health...');
    try {
      const healthResponse = await axios.get(`${baseURL}/api/health-check`, { timeout: 5000 });
      console.log('✅ Server is running:', healthResponse.data);
    } catch (error) {
      console.log('❌ Server health check failed:', error.message);
      // Try other common ports
      const ports = [3001, 3002, 3003, 5000, 5001];
      for (const port of ports) {
        try {
          const response = await axios.get(`http://localhost:${port}/api/health-check`, { timeout: 2000 });
          console.log(`✅ Server found on port ${port}:`, response.data);
          baseURL = `http://localhost:${port}`;
          break;
        } catch (e) {
          continue;
        }
      }
    }

    // Test 2: Test login endpoint with valid credentials
    console.log('\n🔐 [TEST 2] Testing login with valid credentials...');
    try {
      const loginResponse = await axios.post(`${baseURL}/api/auth/login`, {
        email: 'am5544671@gmail.com',
        password: 'Avinash15#'
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      console.log('✅ Login successful:', loginResponse.data);
    } catch (error) {
      console.log('❌ Login failed with error:');
      console.log('   Status:', error.response?.status || 'No status');
      console.log('   Message:', error.response?.data?.message || error.message);
      console.log('   Full error:', error.response?.data || error.response || error);
    }

    // Test 3: Test with other user credentials
    console.log('\n🔐 [TEST 3] Testing with other user credentials...');
    const testUsers = [
      { email: 'admin@hrm.com', password: '123456' },
      { email: 'hr@hrm.com', password: '123456' },
      { email: 'employee@hrm.com', password: '123456' }
    ];

    for (const user of testUsers) {
      try {
        const response = await axios.post(`${baseURL}/api/auth/login`, user, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });
        console.log(`✅ Login successful for ${user.email}:`, response.data.success);
      } catch (error) {
        console.log(`❌ Login failed for ${user.email}:`, error.response?.data?.message || error.message);
      }
    }

    // Test 4: Check user existence in database
    console.log('\n👤 [TEST 4] Checking user existence...');
    try {
      const usersResponse = await axios.get(`${baseURL}/api/users`, {
        headers: {
          'Authorization': 'Bearer dev-local-auth-token'
        },
        timeout: 5000
      });
      console.log('✅ Users found:', usersResponse.data.length);
      usersResponse.data.forEach(user => {
        console.log(`   - ${user.email} (${user.role})`);
      });
    } catch (error) {
      console.log('❌ Failed to fetch users:', error.response?.data?.message || error.message);
    }

  } catch (error) {
    console.error('❌ Debug script failed:', error.message);
  }
}

// Run the debug tests
testAuthEndpoints();
