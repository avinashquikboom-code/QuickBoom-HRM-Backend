const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function testHRLogin() {
  try {
    console.log('🔍 Testing HR Login...');
    
    // 1. Check if HR user exists
    const hrUser = await prisma.user.findUnique({
      where: { email: 'hr@hrm.com' },
      include: {
        profile: true,
        employee: {
          include: {
            office: true,
            department: true,
          },
        },
      },
    });

    console.log('📋 HR User Found:', {
      id: hrUser?.id,
      email: hrUser?.email,
      role: hrUser?.role,
      isActive: hrUser?.isActive,
      hasProfile: !!hrUser?.profile,
      hasEmployee: !!hrUser?.employee,
      employeeName: hrUser?.employee ? `${hrUser.employee.firstName} ${hrUser.employee.lastName}` : 'N/A',
      officeName: hrUser?.employee?.office?.name || 'N/A',
      departmentName: hrUser?.employee?.department?.name || 'N/A',
    });

    if (!hrUser) {
      console.log('❌ HR user not found in database');
      return;
    }

    // 2. Test password verification
    const testPassword = '123456';
    const isPasswordMatch = await bcrypt.compare(testPassword, hrUser.password);
    console.log('🔑 Password Match:', isPasswordMatch);

    // 3. Check mobile compatibility
    const mobileCompatibleRoles = ['EMPLOYEE', 'HR', 'ADMIN'];
    const isMobileCompatible = mobileCompatibleRoles.includes(hrUser.role);
    console.log('📱 Mobile Compatible:', isMobileCompatible);

    // 4. Check office allotment (only required for EMPLOYEE role)
    if (hrUser.role === 'EMPLOYEE') {
      const hasOfficeAllotment = hrUser.employee && hrUser.employee.officeId;
      console.log('🏢 Office Allotted:', hasOfficeAllotment);
    } else {
      console.log('🏢 Office Allotment: Not required for HR role');
    }

    // 5. Test mobile login response structure
    if (hrUser && isPasswordMatch && isMobileCompatible) {
      console.log('✅ HR Login should work!');
      console.log('📤 Mobile Response Structure:', {
        id: hrUser.id,
        email: hrUser.email,
        role: hrUser.role,
        profile: hrUser.profile ? {
          id: hrUser.profile.id,
          fullName: hrUser.profile.fullName,
          phone: hrUser.profile.phone,
          avatarUrl: hrUser.profile.avatarUrl,
          timezone: hrUser.profile.timezone,
          timezoneLabel: hrUser.profile.timezoneLabel,
        } : null,
        employee: hrUser.employee ? {
          id: hrUser.employee.id,
          employeeCode: hrUser.employee.employeeCode,
          firstName: hrUser.employee.firstName,
          lastName: hrUser.employee.lastName,
          designation: hrUser.employee.designation,
          status: hrUser.employee.status,
          department: hrUser.employee.department,
          office: hrUser.employee.office ? {
            id: hrUser.employee.office.id,
            name: hrUser.employee.office.name,
            address: hrUser.employee.office.address,
            latitude: hrUser.employee.office.latitude,
            longitude: hrUser.employee.office.longitude,
            maxRadius: hrUser.employee.office.maxPunchRadiusMeters,
          } : null,
        } : null,
      });
    } else {
      console.log('❌ HR Login would fail due to above issues');
    }

  } catch (error) {
    console.error('💥 Error testing HR login:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testHRLogin();
