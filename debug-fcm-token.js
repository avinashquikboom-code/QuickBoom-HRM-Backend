const axios = require('axios');

async function debugFCMToken() {
  console.log('🔍 [DEBUG] FCM Token registration issue...');

  const baseURL = 'https://quickboom-hrm-backend.onrender.com';
  
  try {
    // Test 1: First try to login to get a token
    console.log('\n🔐 [TEST 1] Attempting login...');
    let authToken = '';
    
    try {
      const loginResponse = await axios.post(`${baseURL}/api/auth/login`, {
        email: 'admin@hrm.com',
        password: '123456'
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: (status) => status < 600
      });
      
      if (loginResponse.data.success) {
        authToken = loginResponse.data.token;
        console.log('✅ Login successful, got token');
      } else {
        console.log('❌ Login failed:', loginResponse.data.message);
        return;
      }
    } catch (error) {
      console.log('❌ Login completely failed:', error.response?.data?.message || error.message);
      console.log('🔧 Trying FCM token registration without auth token...');
    }

    // Test 2: Try FCM token registration
    console.log('\n📱 [TEST 2] Testing FCM token registration...');
    const fcmTokenData = {
      fcmToken: "eOHNpy93RcCzD_a_QSPwfQ:APA91bFKUTHEyST8s6udU96EIr9mcludNaZ_BUqbfgN1SV940eedTNLoe94m4FbXfrZ1G8OBpzvNogYvzFVHyFDVr8NGGRtq7wxF2uPXIeJl5mKUq_GLK7M",
      platform: "android"
    };

    try {
      const fcmResponse = await axios.post(`${baseURL}/api/auth/fcm-token`, fcmTokenData, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        timeout: 10000,
        validateStatus: (status) => status < 600
      });
      
      console.log('✅ FCM token registration response:', fcmResponse.status);
      console.log('📄 Response data:', fcmResponse.data);
      
    } catch (error) {
      console.log('❌ FCM token registration failed:');
      console.log('   Status:', error.response?.status);
      console.log('   Message:', error.response?.data?.message || error.message);
      console.log('   Full error:', error.response?.data || error.message);
      
      // Try different endpoint paths
      const alternativeEndpoints = [
        '/api/fcm-token',
        '/api/notifications/fcm-token',
        '/api/user/fcm-token'
      ];
      
      for (const endpoint of alternativeEndpoints) {
        try {
          const altResponse = await axios.post(`${baseURL}${endpoint}`, fcmTokenData, {
            headers: {
              'Content-Type': 'application/json',
              ...(authToken && { 'Authorization': `Bearer ${authToken}` })
            },
            timeout: 5000,
            validateStatus: (status) => status < 600
          });
          console.log(`✅ Alternative endpoint ${endpoint} worked:`, altResponse.status);
          break;
        } catch (altError) {
          console.log(`❌ Alternative endpoint ${endpoint} failed:`, altError.response?.status);
        }
      }
    }

    // Test 3: Check if FCM token endpoint exists
    console.log('\n🔍 [TEST 3] Checking FCM token endpoints...');
    const fcmEndpoints = [
      '/api/auth/fcm-token',
      '/api/fcm-token/register',
      '/api/notifications/register-token'
    ];
    
    for (const endpoint of fcmEndpoints) {
      try {
        const response = await axios.post(`${baseURL}${endpoint}`, {}, {
          timeout: 3000,
          validateStatus: (status) => status < 600
        });
        console.log(`✅ ${endpoint}: ${response.status}`);
      } catch (error) {
        console.log(`❌ ${endpoint}: ${error.response?.status || 'NETWORK'} - ${error.response?.data?.message || error.message}`);
      }
    }

    // Test 4: Try with different request format
    console.log('\n📝 [TEST 4] Testing different FCM token formats...');
    const alternativeFormats = [
      { token: fcmTokenData.fcmToken, platform: fcmTokenData.platform },
      { fcm_token: fcmTokenData.fcmToken, platform: fcmTokenData.platform },
      { deviceToken: fcmTokenData.fcmToken, platform: fcmTokenData.platform }
    ];
    
    for (const format of alternativeFormats) {
      try {
        const response = await axios.post(`${baseURL}/api/auth/fcm-token`, format, {
          headers: {
            'Content-Type': 'application/json',
            ...(authToken && { 'Authorization': `Bearer ${authToken}` })
          },
          timeout: 5000,
          validateStatus: (status) => status < 600
        });
        console.log(`✅ Format worked:`, Object.keys(format)[0], response.status);
        break;
      } catch (error) {
        console.log(`❌ Format failed:`, Object.keys(format)[0], error.response?.status);
      }
    }

  } catch (error) {
    console.error('❌ Debug script failed:', error.message);
  }
}

// Run the FCM token debug
debugFCMToken();
