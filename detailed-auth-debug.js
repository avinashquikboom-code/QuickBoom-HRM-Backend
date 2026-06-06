const axios = require('axios');

async function detailedAuthDebug() {
  console.log('🔍 [DETAILED DEBUG] Authentication issue investigation...');

  const baseURL = 'https://quickboom-hrm-backend.onrender.com';
  
  try {
    // Test 1: Check if server is responding
    console.log('\n📡 [TEST 1] Basic server connectivity...');
    try {
      const response = await axios.get(`${baseURL}/`, { timeout: 10000 });
      console.log('✅ Server responds at root:', response.status);
    } catch (error) {
      console.log('❌ Root endpoint failed:', error.message);
    }

    // Test 2: Try the exact login request that's failing
    console.log('\n🔐 [TEST 2] Exact failing login request...');
    try {
      const loginResponse = await axios.post(`${baseURL}/api/auth/login`, {
        email: 'am5544671@gmail.com',
        password: 'Avinash15#'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'HRM-App-Debug/1.0'
        },
        timeout: 15000,
        validateStatus: (status) => status < 600 // Don't throw on any status
      });
      
      console.log('✅ Login response status:', loginResponse.status);
      console.log('📄 Login response data:', JSON.stringify(loginResponse.data, null, 2));
      
    } catch (error) {
      console.log('❌ Login request failed:');
      console.log('   Status:', error.response?.status);
      console.log('   Status Text:', error.response?.statusText);
      console.log('   Headers:', error.response?.headers);
      console.log('   Data:', error.response?.data);
      console.log('   Message:', error.message);
      
      // Check if it's a network error vs server error
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        console.log('🔍 This appears to be a network/connectivity issue');
      } else if (error.response?.status >= 500) {
        console.log('🔍 This is a server-side error - check server logs');
      } else if (error.response?.status >= 400) {
        console.log('🔍 This is a client-side error (bad request, auth, etc.)');
      }
    }

    // Test 3: Check if other endpoints work
    console.log('\n🔍 [TEST 3] Test other endpoints...');
    const endpoints = [
      '/api/health-check',
      '/api/auth/register',
      '/api/users'
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${baseURL}${endpoint}`, { 
          timeout: 5000,
          validateStatus: (status) => status < 600
        });
        console.log(`✅ ${endpoint}: ${response.status}`);
      } catch (error) {
        console.log(`❌ ${endpoint}: ${error.response?.status || 'NETWORK'} - ${error.message}`);
      }
    }

    // Test 4: Try with different credentials to isolate user-specific issues
    console.log('\n👤 [TEST 4] Test with different credentials...');
    const testCredentials = [
      { email: 'admin@hrm.com', password: '123456' },
      { email: 'hr@hrm.com', password: '123456' },
      { email: 'employee@hrm.com', password: '123456' }
    ];

    for (const creds of testCredentials) {
      try {
        const response = await axios.post(`${baseURL}/api/auth/login`, creds, {
          timeout: 5000,
          validateStatus: (status) => status < 600
        });
        console.log(`✅ ${creds.email}: ${response.status} - ${response.data.success ? 'SUCCESS' : 'FAILED'}`);
        if (!response.data.success) {
          console.log(`   Message: ${response.data.message}`);
        }
      } catch (error) {
        console.log(`❌ ${creds.email}: ${error.response?.status || 'NETWORK'} - ${error.response?.data?.message || error.message}`);
      }
    }

    console.log('\n🎯 [RECOMMENDATIONS]');
    console.log('1. Check Render server logs for the exact error');
    console.log('2. Verify database connection in production');
    console.log('3. Check if FCM token schema changes broke authentication');
    console.log('4. Verify user exists in production database');

  } catch (error) {
    console.error('❌ Debug script failed:', error.message);
  }
}

// Run the detailed debug
detailedAuthDebug();
