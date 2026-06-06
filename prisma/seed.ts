import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const isLocalDb = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // 1. Clear existing data in reverse order of dependencies
  await prisma.announcement.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.shiftAssignment.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.liveLocation.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.office.deleteMany({});
  await prisma.profile.deleteMany({});
  await prisma.pricingPlan.deleteMany({});
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
      subscriptionPlan: 'Pro',
      billingCycle: 'monthly',
      invoiceStatus: 'Paid',
    },
  });

  const officeKoparkhairne = await prisma.office.create({
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

  const officeDelhi = await prisma.office.create({
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

  // 4. Create Users, Profiles, and Employees
  const adminPasswordHash = await bcrypt.hash('123456', 10);
  const hrPasswordHash = await bcrypt.hash('123456', 10);
  const employeePasswordHash = await bcrypt.hash('123456', 10);

  // A. Super Admin User
  const superAdminUser = await prisma.user.create({
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
      employeeCode: 'HR001',
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
      employeeCode: 'QB001',
      firstName: 'Rahul',
      lastName: 'Verma',
      designation: 'Software Engineer',
      status: 'active',
      officeId: officeMumbai.id,
      departmentId: deptEngineering.id,
    },
  });

  // D. Additional Employee User (am5544671@gmail.com)
  const customPasswordHash = await bcrypt.hash('Avinash15#', 10);
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

  // Create Employee profile for custom user
  const customEmployee = await prisma.employee.create({
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

  // E. Mock unregistered employee (without User account yet)
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
      isFingerprintCheckIn: false,
      isFingerprintCheckOut: false,
      isOnBreak: false,
      totalBreakSeconds: 1800, // 30 mins break
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

  // 8. Create Shifts and Shift Assignments
  const standardShift = await prisma.shift.create({
    data: {
      name: 'Regular Morning Shift',
      startTime: '09:00',
      endTime: '18:00',
      workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      graceMinutes: 15,
      breakMinutes: 60,
      color: '#3BA38B',
    },
  });

  await prisma.shiftAssignment.create({
    data: {
      employeeId: employee.id,
      shiftId: standardShift.id,
      effectiveFrom: new Date(new Date().setDate(yesterday.getDate() - 30)),
    },
  });

  // 9. Create Leave Requests & Leave Balance defaults
  const now = new Date();
  await prisma.leaveRequest.createMany({
    data: [
      {
        employeeId: employee.id,
        type: 'CASUAL',
        fromDate: new Date(new Date().setDate(now.getDate() - 30)),
        toDate: new Date(new Date().setDate(now.getDate() - 29)),
        reason: 'Personal work at home',
        status: 'APPROVED',
        appliedOn: new Date(new Date().setDate(now.getDate() - 35)),
        reviewedBy: 'Priya Sharma',
        reviewNote: 'Approved',
      },
      {
        employeeId: employee.id,
        type: 'SICK',
        fromDate: new Date(new Date().setDate(now.getDate() - 60)),
        toDate: new Date(new Date().setDate(now.getDate() - 60)),
        reason: 'Fever and cold',
        status: 'APPROVED',
        appliedOn: new Date(new Date().setDate(now.getDate() - 61)),
        reviewedBy: 'Priya Sharma',
        reviewNote: 'Get well soon',
      },
      {
        employeeId: employee.id,
        type: 'EARNED',
        fromDate: new Date(new Date().setDate(now.getDate() + 10)),
        toDate: new Date(new Date().setDate(now.getDate() + 14)),
        reason: 'Family vacation trip',
        status: 'PENDING',
        appliedOn: new Date(new Date().setDate(now.getDate() - 2)),
      },
      {
        employeeId: employee.id,
        type: 'CASUAL',
        fromDate: new Date(new Date().setDate(now.getDate() - 10)),
        toDate: new Date(new Date().setDate(now.getDate() - 10)),
        reason: 'Bank work',
        status: 'REJECTED',
        appliedOn: new Date(new Date().setDate(now.getDate() - 12)),
        reviewedBy: 'Priya Sharma',
        reviewNote: 'Critical project deadline, please reschedule.',
      },
    ],
  });

  // 10. Create Expenses
  await prisma.expense.createMany({
    data: [
      {
        employeeId: employee.id,
        category: 'TRAVEL',
        amount: 1200.0,
        description: 'Client office visit taxi fare',
        date: new Date(new Date().setDate(now.getDate() - 5)),
        status: 'APPROVED',
        submittedOn: new Date(new Date().setDate(now.getDate() - 5)),
        reviewedBy: 'Priya Sharma',
        reviewNote: 'Reimbursement processed.',
        hasReceipt: true,
        receiptUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?w=500',
      },
      {
        employeeId: employee.id,
        category: 'FOOD',
        amount: 450.0,
        description: 'Dinner during late-night backend deployment',
        date: new Date(new Date().setDate(now.getDate() - 2)),
        status: 'PENDING',
        submittedOn: new Date(new Date().setDate(now.getDate() - 2)),
        hasReceipt: true,
        receiptUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?w=500',
      },
    ],
  });

  // 11. Create Tasks
  await prisma.task.createMany({
    data: [
      {
        title: 'API Integration',
        description: 'Integrate employee attendance and shift APIs with the mobile client.',
        assignedToId: employee.id,
        assignedById: superAdminUser.id,
        projectName: 'Quickboom Mobile App',
        dueDate: new Date(new Date().setDate(now.getDate() + 3)),
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      },
      {
        title: 'Code Review',
        description: 'Review pull requests for the HR dashboard page.',
        assignedToId: employee.id,
        assignedById: superAdminUser.id,
        projectName: 'HRM Web Dashboard',
        dueDate: new Date(new Date().setDate(now.getDate() + 5)),
        status: 'TODO',
        priority: 'MEDIUM',
      },
      {
        title: 'Bug Fixing',
        description: 'Resolve date alignment issue on geofence check-in page.',
        assignedToId: employee.id,
        assignedById: superAdminUser.id,
        projectName: 'Quickboom Mobile App',
        dueDate: new Date(new Date().setDate(now.getDate() - 1)),
        status: 'COMPLETED',
        priority: 'HIGH',
      },
    ],
  });

  // 12. Create Notifications
  await prisma.notification.createMany({
    data: [
      {
        employeeId: employee.id,
        title: 'Shift Assigned',
        body: 'You have been assigned to Regular Morning Shift starting today.',
        category: 'ATTENDANCE',
        isRead: false,
        createdAt: new Date(new Date().setHours(9, 0, 0)),
      },
      {
        employeeId: employee.id,
        title: 'Leave Approved',
        body: 'Your casual leave request for next week has been approved by Priya Sharma.',
        category: 'LEAVE',
        isRead: true,
        createdAt: new Date(new Date().setDate(now.getDate() - 3)),
      },
      {
        employeeId: employee.id,
        title: 'New Task Assigned',
        body: 'Super Admin assigned you a new task: API Integration.',
        category: 'TASK',
        isRead: false,
        createdAt: new Date(new Date().setHours(10, 15, 0)),
      },
    ],
  });

  // 13. Create Announcements
  await prisma.announcement.createMany({
    data: [
      {
        title: 'Annual Company Meet 2026',
        content: 'We are excited to announce our Annual Meet will be held in Goa in September! Pack your bags!',
        category: 'GENERAL',
        publishedBy: 'Priya Sharma',
        createdAt: new Date(new Date().setDate(now.getDate() - 1)),
      },
      {
        title: 'New Health Insurance Policy',
        content: 'Our health insurance provider has been updated. Please download the new card from the documents tab.',
        category: 'BENEFITS',
        publishedBy: 'Priya Sharma',
        createdAt: new Date(new Date().setDate(now.getDate() - 4)),
      },
    ],
  });

  // 14. Create Default Pricing Plans
  await prisma.pricingPlan.createMany({
    data: [
      {
        name: 'Basic',
        monthlyPrice: 1200.0,
        yearlyPrice: 12000.0,
        seatsLabel: 'Up to 50 active seats',
        description: 'Essential features for growing startups.',
        features: ['Standard dashboard analytics', 'Up to 5 geofences', 'Email support', '1-year logs retention'],
      },
      {
        name: 'Pro',
        monthlyPrice: 4500.0,
        yearlyPrice: 45000.0,
        seatsLabel: 'Up to 250 active seats',
        description: 'Advanced controls for professional enterprises.',
        features: ['Real-time live location tracking', 'Unlimited geofencing alerts', '24/7 priority support', 'Custom report building', 'SSO & Multi-admin access'],
      },
      {
        name: 'Enterprise',
        monthlyPrice: 12400.0,
        yearlyPrice: 124000.0,
        seatsLabel: 'Unlimited seats & servers',
        description: 'State-of-the-art power for global organizations.',
        features: ['Dedicated account architect', 'Custom backend API pipelines', 'Tailored hardware integrations', 'Unlimited logs & backups', 'Whiteglove data onboarding'],
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
