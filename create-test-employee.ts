import bcrypt from 'bcrypt';
import { prisma } from './src/utils/db';

async function createTestEmployee() {
  try {
    // Create test user
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const user = await prisma.user.create({
      data: {
        email: 'employee@test.com',
        password: hashedPassword,
        role: 'EMPLOYEE',
        isActive: true,
      },
    });

    // Create profile
    await prisma.profile.create({
      data: {
        userId: user.id,
        email: 'employee@test.com',
        fullName: 'Test Employee',
        phone: '+1234567890',
      },
    });

    // Create employee record
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        employeeCode: 'EMP001',
        firstName: 'Test',
        lastName: 'Employee',
        designation: 'Software Developer',
        status: 'active',
      },
    });

    console.log('✅ Test employee created successfully:');
    console.log('Email: employee@test.com');
    console.log('Password: password123');
    console.log('Employee Code: EMP001');
    console.log('User ID:', user.id);
    console.log('Employee ID:', employee.id);

  } catch (error) {
    console.error('❌ Error creating test employee:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestEmployee();
