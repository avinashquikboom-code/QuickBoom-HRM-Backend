import { prisma } from '../utils/db';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function seedSafe() {
  try {
    console.log('Starting safe database seed...');

    // 1. Create Departments if they don't exist
    let deptHR = await prisma.department.findFirst({ where: { code: 'DEPT-HR' } });
    if (!deptHR) {
      deptHR = await prisma.department.create({
        data: { name: 'Human Resources', code: 'DEPT-HR' },
      });
      console.log('Created department: Human Resources');
    }

    let deptEngineering = await prisma.department.findFirst({ where: { code: 'DEPT-ENG' } });
    if (!deptEngineering) {
      deptEngineering = await prisma.department.create({
        data: { name: 'Engineering', code: 'DEPT-ENG' },
      });
      console.log('Created department: Engineering');
    }

    let deptOperations = await prisma.department.findFirst({ where: { code: 'DEPT-OPS' } });
    if (!deptOperations) {
      deptOperations = await prisma.department.create({
        data: { name: 'Operations', code: 'DEPT-OPS' },
      });
      console.log('Created department: Operations');
    }

    // 2. Create Offices if they don't exist
    let officeMumbai = await prisma.office.findFirst({ where: { code: 'OFF-BOM-02' } });
    if (!officeMumbai) {
      officeMumbai = await prisma.office.create({
        data: {
          name: 'Mumbai Branch',
          code: 'OFF-BOM-02',
          address: 'Bandra Kurla Complex, Mumbai, Maharashtra 400051',
          latitude: 19.0760,
          longitude: 72.8777,
          idealRadiusMeters: 50,
          maxPunchRadiusMeters: 100,
          isActive: true,
          subscriptionPlan: 'Pro',
          billingCycle: 'monthly',
          invoiceStatus: 'Paid',
        },
      });
      console.log('Created office: Mumbai Branch');
    }

    let officeKoparkhairne = await prisma.office.findFirst({ where: { code: 'OFF-KOP-03' } });
    if (!officeKoparkhairne) {
      officeKoparkhairne = await prisma.office.create({
        data: {
          name: 'Koparkhairne Office',
          code: 'OFF-KOP-03',
          address: 'Koparkhairne, Navi Mumbai, Maharashtra 400709',
          latitude: 19.0420,
          longitude: 73.0600,
          idealRadiusMeters: 50,
          maxPunchRadiusMeters: 100,
          isActive: true,
          subscriptionPlan: 'Pro',
          billingCycle: 'monthly',
          invoiceStatus: 'Paid',
        },
      });
      console.log('Created office: Koparkhairne Office');
    }

    let officeDelhi = await prisma.office.findFirst({ where: { code: 'OFF-DEL-01' } });
    if (!officeDelhi) {
      officeDelhi = await prisma.office.create({
        data: {
          name: 'Delhi Headquarters',
          code: 'OFF-DEL-01',
          address: 'Connaught Place, New Delhi, Delhi 110001',
          latitude: 28.6140,
          longitude: 77.2091,
          idealRadiusMeters: 50,
          maxPunchRadiusMeters: 100,
          isActive: true,
          subscriptionPlan: 'Enterprise',
          billingCycle: 'monthly',
          invoiceStatus: 'Paid',
        },
      });
      console.log('Created office: Delhi Headquarters');
    }

    // Hash passwords
    const adminPasswordHash = await bcrypt.hash('123456', 10);
    const hrPasswordHash = await bcrypt.hash('123456', 10);
    const employeePasswordHash = await bcrypt.hash('123456', 10);
    const customPasswordHash = await bcrypt.hash('Avinash15#', 10);

    // 3. Create Users, Profiles, Employees if not existing
    
    // A. Super Admin User
    const existingAdmin = await prisma.user.findUnique({ where: { email: 'admin@hr.com' } });
    if (!existingAdmin) {
      await prisma.user.create({
        data: {
          email: 'admin@hr.com',
          password: adminPasswordHash,
          role: Role.SUPER_ADMIN,
          isActive: true,
          profile: {
            create: {
              email: 'admin@hrm.com',
              fullName: 'Super Admin',
              phone: '+919999999999',
              bio: 'Global Platform Administrator',
              clearanceLevel: 4,
              clearanceLabel: 'Level 4 (Super Admin)',
              timezone: 'Asia/Kolkata',
              timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
              twoFactorEnabled: false,
              twoFactorStatus: 'disabled',
              lastLoginLocation: 'Delhi HQ',
            },
          },
        },
      });
      console.log('Created user: admin@hr.com');
    }

    // B. HR Admin User
    const existingHr = await prisma.user.findUnique({ where: { email: 'hr@hrm.com' } });
    if (!existingHr) {
      const hrUser = await prisma.user.create({
        data: {
          email: 'hr@hrm.com',
          password: hrPasswordHash,
          role: Role.HR,
          isActive: true,
          profile: {
            create: {
              email: 'hr@hrm.com',
              fullName: 'Priya Sharma',
              phone: '+919876543210',
              bio: 'HR Manager & Recruiter',
              clearanceLevel: 3,
              clearanceLabel: 'Level 3 (HR Lead)',
              timezone: 'Asia/Kolkata',
              timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
              twoFactorEnabled: true,
              twoFactorStatus: 'active',
              lastLoginLocation: 'Delhi HQ',
            },
          },
        },
      });
      
      await prisma.employee.create({
        data: {
          userId: hrUser.id,
          employeeCode: 'HR001',
          firstName: 'Priya',
          lastName: 'Sharma',
          designation: 'HR Manager',
          status: 'active',
          officeId: officeDelhi.id,
          departmentId: deptHR.id,
        },
      });
      console.log('Created user and employee profile for: hr@hrm.com');
    }

    // C. Regular Employee User
    const existingEmployee = await prisma.user.findUnique({ where: { email: 'employee@hrm.com' } });
    if (!existingEmployee) {
      const employeeUser = await prisma.user.create({
        data: {
          email: 'employee@hrm.com',
          password: employeePasswordHash,
          role: Role.EMPLOYEE,
          isActive: true,
          profile: {
            create: {
              email: 'employee@hrm.com',
              fullName: 'Rahul Verma',
              phone: '+919812345678',
              bio: 'Full Stack Software Engineer',
              clearanceLevel: 1,
              clearanceLabel: 'Level 1 (General)',
              timezone: 'Asia/Kolkata',
              timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
              twoFactorEnabled: false,
              twoFactorStatus: 'disabled',
              lastLoginLocation: 'Mumbai Branch',
            },
          },
        },
      });

      await prisma.employee.create({
        data: {
          userId: employeeUser.id,
          employeeCode: 'QB001',
          firstName: 'Rahul',
          lastName: 'Verma',
          designation: 'Software Engineer',
          status: 'active',
          officeId: officeMumbai.id,
          departmentId: deptEngineering.id,
        },
      });
      console.log('Created user and employee profile for: employee@hrm.com');
    }

    // D. Custom Employee User
    const existingCustom = await prisma.user.findUnique({ where: { email: 'am5544671@gmail.com' } });
    if (!existingCustom) {
      const customEmployeeUser = await prisma.user.create({
        data: {
          email: 'am5544671@gmail.com',
          password: customPasswordHash,
          role: Role.EMPLOYEE,
          isActive: true,
          profile: {
            create: {
              email: 'am5544671@gmail.com',
              fullName: 'Avinash Magar',
              phone: '+919876543210',
              bio: 'Mobile App Developer',
              clearanceLevel: 1,
              clearanceLabel: 'Level 1 (General)',
              timezone: 'Asia/Kolkata',
              timezoneLabel: '(GMT+5:30) Mumbai, New Delhi',
              twoFactorEnabled: false,
              twoFactorStatus: 'disabled',
              lastLoginLocation: 'Koparkhairne Office',
            },
          },
        },
      });

      await prisma.employee.create({
        data: {
          userId: customEmployeeUser.id,
          employeeCode: 'QB002',
          firstName: 'Avinash',
          lastName: 'Magar',
          designation: 'Mobile Developer',
          status: 'active',
          officeId: officeKoparkhairne.id,
          departmentId: deptEngineering.id,
        },
      });
      console.log('Created user and employee profile for: am5544671@gmail.com');
    }

    console.log('Safe database seed completed successfully!');
  } catch (error: any) {
    console.error('Error during safe database seed:', error.message || error);
  } finally {
    await prisma.$disconnect();
  }
}

seedSafe();
