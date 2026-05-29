import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // 1. Clear existing data
  await prisma.liveLocation.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.office.deleteMany({});
  await prisma.profile.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Create Departments
  const deptHR = await prisma.department.create({
    data: { name: 'Human Resources', code: 'DEPT-HR' },
  });

  const deptEngineering = await prisma.department.create({
    data: { name: 'Engineering', code: 'DEPT-ENG' },
  });

  const deptOperations = await prisma.department.create({
    data: { name: 'Operations', code: 'DEPT-OPS' },
  });

  // 3. Create Offices
  const officeDelhi = await prisma.office.create({
    data: {
      name: 'Delhi HQ',
      code: 'OFF-DEL-01',
      address: 'Connaught Place, New Delhi, Delhi 110001',
      latitude: 28.6139,
      longitude: 77.2090,
      idealRadiusMeters: 50,
      maxPunchRadiusMeters: 100,
      isActive: true,
    },
  });

  const officeMumbai = await prisma.office.create({
    data: {
      name: 'Mumbai Branch',
      code: 'OFF-BOM-02',
      address: 'Bandra Kurla Complex, Mumbai, Maharashtra 400051',
      latitude: 19.0760,
      longitude: 72.8777,
      idealRadiusMeters: 50,
      maxPunchRadiusMeters: 100,
      isActive: true,
    },
  });

  // 4. Create Users, Profiles, and Employees
  const adminPasswordHash = await bcrypt.hash('123456', 10);
  const hrPasswordHash = await bcrypt.hash('123456', 10);
  const employeePasswordHash = await bcrypt.hash('employee123', 10);

  // A. Super Admin User
  const superAdminUser = await prisma.user.create({
    data: {
      email: 'admin@hrm.com',
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

  // B. HR Admin User (acts as HR / PLATFORM_ADMIN)
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

  // Create HR Employee profile
  const hrEmployee = await prisma.employee.create({
    data: {
      userId: hrUser.id,
      employeeCode: 'EMP-HR-001',
      firstName: 'Priya',
      lastName: 'Sharma',
      designation: 'HR Manager',
      status: 'active',
      officeId: officeDelhi.id,
      departmentId: deptHR.id,
    },
  });

  // C. Regular Employee User
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

  // Create Employee profile
  const employee = await prisma.employee.create({
    data: {
      userId: employeeUser.id,
      employeeCode: 'EMP-ENG-001',
      firstName: 'Rahul',
      lastName: 'Verma',
      designation: 'Software Engineer',
      status: 'active',
      officeId: officeMumbai.id,
      departmentId: deptEngineering.id,
    },
  });

  // D. Mock unregistered employee (without User account yet)
  const unregisteredEmployee = await prisma.employee.create({
    data: {
      employeeCode: 'EMP-OPS-999',
      firstName: 'Amit',
      lastName: 'Kumar',
      designation: 'Operations Lead',
      status: 'active',
      officeId: officeMumbai.id,
      departmentId: deptOperations.id,
    },
  });

  // 5. Create Attendance Records
  // Rahul present today
  await prisma.attendance.create({
    data: {
      employeeId: employee.id,
      officeId: officeMumbai.id,
      date: new Date().toISOString().split('T')[0],
      checkIn: new Date(new Date().setHours(9, 15, 0)),
      checkOut: new Date(new Date().setHours(17, 30, 0)),
      status: 'PRESENT',
      notes: 'On time, check-in via geofence',
      latitude: 19.0762,
      longitude: 72.8778,
    },
  });

  // Priya present today
  await prisma.attendance.create({
    data: {
      employeeId: hrEmployee.id,
      officeId: officeDelhi.id,
      date: new Date().toISOString().split('T')[0],
      checkIn: new Date(new Date().setHours(9, 30, 0)),
      checkOut: null,
      status: 'PRESENT',
      notes: 'Punching from Delhi Headquarters',
      latitude: 28.6140,
      longitude: 77.2091,
    },
  });

  // Historical records for employee (Rahul Verma)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await prisma.attendance.create({
    data: {
      employeeId: employee.id,
      officeId: officeMumbai.id,
      date: yesterday.toISOString().split('T')[0],
      checkIn: new Date(yesterday.setHours(9, 0, 0)),
      checkOut: new Date(yesterday.setHours(18, 0, 0)),
      status: 'PRESENT',
      notes: 'Standard day',
    },
  });

  // 6. Create Comments
  await prisma.comment.create({
    data: {
      entityType: 'OFFICE',
      entityId: officeDelhi.id.toString(),
      content: 'Added new geofence parameters to expand office coverage.',
      authorId: superAdminUser.id,
    },
  });

  await prisma.comment.create({
    data: {
      entityType: 'EMPLOYEE',
      entityId: employee.id.toString(),
      content: 'Performance review completed. Promoted to Senior Software Engineer.',
      authorId: hrUser.id,
    },
  });

  // 7. Create Telemetry Live Locations
  await prisma.liveLocation.createMany({
    data: [
      {
        employeeId: hrEmployee.id,
        name: 'Priya Sharma',
        role: 'HR Manager',
        lat: 28.6139,
        lng: 77.2090,
        status: 'In Office',
        speed: '0 km/h',
        battery: '92%',
      },
      {
        employeeId: employee.id,
        name: 'Rahul Verma',
        role: 'Software Engineer',
        lat: 19.0760,
        lng: 72.8777,
        status: 'In Office',
        speed: '0 km/h',
        battery: '85%',
      },
      {
        employeeId: unregisteredEmployee.id,
        name: 'Amit Kumar',
        role: 'Operations Lead',
        lat: 19.0820,
        lng: 72.8820,
        status: 'In Office',
        speed: '0 km/h',
        battery: '95%',
      },
    ],
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
