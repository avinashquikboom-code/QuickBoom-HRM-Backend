const { prisma } = require('./dist/utils/db.js');

async function checkEmployees() {
  try {
    console.log('🔍 Checking employee accounts...\n');
    
    // Get all users with employee data
    const users = await prisma.user.findMany({
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
            department: true,
          }
        }
      }
    });
    
    console.log(`Found ${users.length} users:\n`);
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. User Account:`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Status: ${user.isActive ? 'Active' : 'Inactive'}`);
      
      if (user.employee) {
        console.log(`   Employee Code: ${user.employee.employeeCode}`);
        console.log(`   Name: ${user.employee.firstName} ${user.employee.lastName}`);
        console.log(`   Designation: ${user.employee.designation || 'N/A'}`);
        console.log(`   Employee Status: ${user.employee.status}`);
        
        if (user.employee.office) {
          console.log(`   Office: ${user.employee.office.name}`);
        }
        
        if (user.employee.department) {
          console.log(`   Department: ${user.employee.department.name}`);
        }
      }
      
      console.log('   ---');
    });
    
    // Check if there are any test/demo accounts
    console.log('\n📝 Test Account Suggestions:');
    console.log('If you need to create a test employee account, you can use:');
    console.log('- Email: employee@quickboom.com');
    console.log('- Password: employee123');
    console.log('- Or: hr@quickboom.com / hr123');
    console.log('- Or: admin@quickboom.com / admin123');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkEmployees();
