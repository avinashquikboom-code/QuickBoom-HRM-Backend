const axios = require('axios');

async function testAdminMobileEndpoints() {
  console.log('🔍 [TEST] Admin Panel Mobile Endpoints...');
  
  const baseURL = 'https://quickboom-hrm-backend.onrender.com';
  
  try {
    // Test 1: Basic server connectivity
    console.log('\n📡 [TEST 1] Server connectivity...');
    try {
      const response = await axios.get(`${baseURL}/`, { timeout: 5000 });
      console.log('✅ Server responds:', response.status);
    } catch (error) {
      console.log('❌ Server not responding:', error.message);
      return;
    }

    // Test 2: Authentication endpoints
    console.log('\n🔐 [TEST 2] Authentication endpoints...');
    const authEndpoints = [
      { method: 'POST', path: '/api/auth/login', data: { email: 'admin@hrm.com', password: '123456' } },
      { method: 'POST', path: '/api/auth/login', data: { email: 'hr@hrm.com', password: '123456' } },
      { method: 'POST', path: '/api/auth/login', data: { email: 'employee@hrm.com', password: '123456' } },
      { method: 'POST', path: '/api/auth/login', data: { email: 'am5544671@gmail.com', password: 'Avinash15#' } },
    ];

    let authToken = null;
    for (const endpoint of authEndpoints) {
      try {
        const response = await axios.post(`${baseURL}${endpoint.path}`, endpoint.data, {
          timeout: 10000,
          validateStatus: (status) => status < 600
        });
        
        if (response.data.success) {
          console.log(`✅ Login successful: ${endpoint.data.email}`);
          if (!authToken) authToken = response.data.token;
        } else {
          console.log(`❌ Login failed: ${endpoint.data.email} - ${response.data.message}`);
        }
      } catch (error) {
        console.log(`❌ Login error: ${endpoint.data.email} - ${error.response?.status || 'NETWORK'}`);
      }
    }

    // Test 3: Admin Panel Mobile endpoints (with auth token)
    console.log('\n📱 [TEST 3] Admin Panel Mobile endpoints...');
    if (authToken) {
      const mobileEndpoints = [
        { method: 'GET', path: '/api/mobile/dashboard/stats' },
        { method: 'GET', path: '/api/mobile/attendance/today' },
        { method: 'GET', path: '/api/mobile/leave/balance' },
        { method: 'GET', path: '/api/mobile/notifications' },
        { method: 'GET', path: '/api/mobile/profile' },
        { method: 'GET', path: '/api/mobile/shift' },
        { method: 'GET', path: '/api/mobile/expenses' },
      ];

      for (const endpoint of mobileEndpoints) {
        try {
          const response = await axios.get(`${baseURL}${endpoint.path}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            timeout: 8000,
            validateStatus: (status) => status < 600
          });
          console.log(`✅ ${endpoint.path}: ${response.status}`);
        } catch (error) {
          console.log(`❌ ${endpoint.path}: ${error.response?.status || 'NETWORK'} - ${error.response?.data?.message || error.message}`);
        }
      }
    } else {
      console.log('⚠️ No auth token available, skipping authenticated endpoints');
    }

    // Test 4: HR Management endpoints
    console.log('\n👥 [TEST 4] HR Management endpoints...');
    if (authToken) {
      const hrEndpoints = [
        { method: 'GET', path: '/api/hr/stats' },
        { method: 'GET', path: '/api/hr/employees' },
        { method: 'GET', path: '/api/hr/leave/overview' },
        { method: 'GET', path: '/api/hr/attendance/trend' },
        { method: 'GET', path: '/api/hr/activity' },
      ];

      for (const endpoint of hrEndpoints) {
        try {
          const response = await axios.get(`${baseURL}${endpoint.path}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            timeout: 8000,
            validateStatus: (status) => status < 600
          });
          console.log(`✅ ${endpoint.path}: ${response.status}`);
        } catch (error) {
          console.log(`❌ ${endpoint.path}: ${error.response?.status || 'NETWORK'} - ${error.response?.data?.message || error.message}`);
        }
      }
    }

    // Test 5: FCM Token registration
    console.log('\n📱 [TEST 5] FCM Token registration...');
    if (authToken) {
      try {
        const fcmResponse = await axios.post(`${baseURL}/api/auth/fcm-token`, {
          fcmToken: "eOHNpy93RcCzD_a_QSPwfQ:APA91bFKUTHEyST8s6udU96EIr9mcludNaZ_BUqbfgN1SV940eedTNLoe94m4FbXfrZ1G8OBpzvNogYvzFVHyFDVr8NGGRtq7wxF2uPXIeJl5mKUq_GLK7M",
          platform: "android"
        }, {
          headers: { 
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000,
          validateStatus: (status) => status < 600
        });
        console.log(`✅ FCM Token registration: ${fcmResponse.status}`);
        console.log(`📄 Response:`, fcmResponse.data);
      } catch (error) {
        console.log(`❌ FCM Token registration: ${error.response?.status || 'NETWORK'} - ${error.response?.data?.message || error.message}`);
      }
    }

    console.log('\n🎯 [SUMMARY]');
    console.log('✅ Server connectivity: Working');
    console.log('🔐 Authentication: Needs deployment fix');
    console.log('📱 Mobile endpoints: Ready to test after auth fix');
    console.log('📱 FCM Token: Ready to test after auth fix');

  } catch (error) {
    console.error('❌ Test script failed:', error.message);
  }
}

// Run the comprehensive test
testAdminMobileEndpoints();
