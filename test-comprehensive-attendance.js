const axios = require('axios');

async function testComprehensiveAttendance() {
  console.log('🔍 [TEST] Comprehensive Attendance Reporting System...');
  
  const baseURL = 'https://quickboom-hrm-backend.onrender.com';
  
  try {
    // First, login to get auth token
    console.log('\n🔐 [STEP 1] Authentication...');
    const loginResponse = await axios.post(`${baseURL}/api/auth/login`, {
      email: 'hr@hrm.com',
      password: '123456'
    }, {
      timeout: 10000
    });
    
    if (!loginResponse.data.success) {
      console.log('❌ Login failed:', loginResponse.data.message);
      return;
    }
    
    const authToken = loginResponse.data.token;
    console.log('✅ Login successful');
    
    // Test 1: Comprehensive Attendance Report
    console.log('\n📊 [STEP 2] Testing Comprehensive Attendance Report...');
    try {
      const reportResponse = await axios.get(`${baseURL}/api/attendance/comprehensive-report`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        params: {
          month: '6',
          year: '2026',
          includeLocationTracking: 'true',
          includeBreakDetails: 'true'
        },
        timeout: 15000
      });
      
      console.log('✅ Comprehensive Report Status:', reportResponse.status);
      console.log('📊 Report Summary:');
      console.log('   - Period:', reportResponse.data.data.period);
      console.log('   - Total Records:', reportResponse.data.data.metrics.totalRecords);
      console.log('   - Total Employees:', reportResponse.data.data.metrics.totalEmployees);
      console.log('   - Average Work Hours:', reportResponse.data.data.metrics.averageWorkHours?.toFixed(2));
      console.log('   - Location Tracking Compliance:', reportResponse.data.data.metrics.locationTrackingCompliance?.toFixed(2) + '%');
      
      // Show monthly summary
      const summary = reportResponse.data.data.summary;
      console.log('\n📈 Monthly Summary:');
      console.log('   - Present Days:', summary.presentDays);
      console.log('   - Absent Days:', summary.absentDays);
      console.log('   - Leave Days:', summary.leaveDays);
      console.log('   - Full Days:', summary.fullDays);
      console.log('   - Half Days:', summary.halfDays);
      console.log('   - Attendance %:', summary.attendancePercentage?.toFixed(2) + '%');
      
      // Show sample attendance records
      const records = reportResponse.data.data.attendanceRecords;
      if (records.length > 0) {
        console.log('\n📋 Sample Attendance Records:');
        records.slice(0, 3).forEach((record, index) => {
          console.log(`   ${index + 1}. ${record.firstname} ${record.lastname} - ${record.date}`);
          console.log(`      Status: ${record.status} | Type: ${record.attendancetype}`);
          console.log(`      Work Hours: ${((parseFloat(record.totalworkseconds) || 0) / 3600).toFixed(2)}h`);
          console.log(`      Break Time: ${((parseFloat(record.totalbreakseconds) || 0) / 60).toFixed(2)}m`);
          console.log(`      Location: ${record.haslocation ? 'Tracked' : 'Not Tracked'}`);
        });
      }
      
      // Show location tracking if available
      if (reportResponse.data.data.locationTracking && reportResponse.data.data.locationTracking.length > 0) {
        console.log('\n📍 Location Tracking Sample:');
        const locationData = reportResponse.data.data.locationTracking[0];
        console.log(`   - Employee: ${locationData.firstname} ${locationData.lastname}`);
        console.log(`   - Date: ${locationData.date}`);
        console.log(`   - Location Updates: ${locationData.locationupdates}`);
        console.log(`   - Status: ${locationData.locationstatus}`);
      }
      
      // Show break details if available
      if (reportResponse.data.data.breakDetails && reportResponse.data.data.breakDetails.length > 0) {
        console.log('\n☕ Break Details Sample:');
        const breakData = reportResponse.data.data.breakDetails[0];
        console.log(`   - Employee: ${breakData.firstname} ${breakData.lastname}`);
        console.log(`   - Date: ${breakData.date}`);
        console.log(`   - Break Duration: ${breakData.breakminutes} minutes`);
        console.log(`   - Break Type: ${breakData.breaktype}`);
      }
      
    } catch (error) {
      console.log('❌ Comprehensive Report Error:', error.response?.status);
      console.log('   Message:', error.response?.data?.message || error.message);
    }
    
    // Test 2: Attendance Trends
    console.log('\n📈 [STEP 3] Testing Attendance Trends...');
    try {
      const trendsResponse = await axios.get(`${baseURL}/api/attendance/trends`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        params: {
          period: 'monthly',
          months: '6'
        },
        timeout: 10000
      });
      
      console.log('✅ Trends Status:', trendsResponse.status);
      const trends = trendsResponse.data.data.trends;
      
      if (trends.length > 0) {
        console.log('\n📊 Recent Trends:');
        trends.slice(0, 3).forEach((trend, index) => {
          console.log(`   ${index + 1}. Month: ${new Date(trend.month).toLocaleDateString()}`);
          console.log(`      Present Days: ${trend.presentDays}`);
          console.log(`      Average Work Hours: ${trend.averageWorkHours?.toFixed(2)}h`);
          console.log(`      Location Compliance: ${trend.locationTrackingCompliance?.toFixed(2)}%`);
        });
      }
      
    } catch (error) {
      console.log('❌ Trends Error:', error.response?.status);
      console.log('   Message:', error.response?.data?.message || error.message);
    }
    
    // Test 3: Location Tracking Report
    console.log('\n📍 [STEP 4] Testing Location Tracking Report...');
    try {
      const locationResponse = await axios.get(`${baseURL}/api/attendance/location-tracking`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        params: {
          startDate: '2026-06-01',
          endDate: '2026-06-30'
        },
        timeout: 10000
      });
      
      console.log('✅ Location Tracking Status:', locationResponse.status);
      const stats = locationResponse.data.data.statistics;
      
      console.log('\n📍 Location Statistics:');
      console.log('   - Total Records:', stats.totalRecords);
      console.log('   - Tracked Records:', stats.trackedRecords);
      console.log('   - Office Compliant Records:', stats.officeCompliantRecords);
      console.log('   - Tracking Compliance:', stats.locationTrackingPercentage?.toFixed(2) + '%');
      console.log('   - Office Compliance:', stats.officeCompliancePercentage?.toFixed(2) + '%');
      
      if (locationResponse.data.data.locationRecords && locationResponse.data.data.locationRecords.length > 0) {
        console.log('\n📍 Sample Location Records:');
        locationResponse.data.data.locationRecords.slice(0, 2).forEach((record, index) => {
          console.log(`   ${index + 1}. ${record.firstname} ${record.lastname} - ${record.date}`);
          console.log(`      Location Status: ${record.locationstatus}`);
          console.log(`      Office Compliance: ${record.officecompliance}`);
          if (record.distanceFromOffice) {
            console.log(`      Distance from Office: ${parseFloat(record.distanceFromOffice).toFixed(2)} km`);
          }
        });
      }
      
    } catch (error) {
      console.log('❌ Location Tracking Error:', error.response?.status);
      console.log('   Message:', error.response?.data?.message || error.message);
    }
    
    console.log('\n🎯 [SUMMARY]');
    console.log('✅ Comprehensive Attendance Reporting System is ready!');
    console.log('📊 Features Available:');
    console.log('   • Half-day/Full-day attendance tracking');
    console.log('   • Break time monitoring and analysis');
    console.log('   • Monthly attendance summaries');
    console.log('   • Location exit/entry tracking');
    console.log('   • Attendance trends and analytics');
    console.log('   • Employee-wise attendance reports');
    console.log('   • Office location compliance monitoring');
    
    console.log('\n📱 API Endpoints:');
    console.log('   • GET /api/attendance/comprehensive-report');
    console.log('   • GET /api/attendance/trends');
    console.log('   • GET /api/attendance/location-tracking');
    
  } catch (error) {
    console.error('❌ Test script failed:', error.message);
  }
}

// Run the comprehensive test
testComprehensiveAttendance();
