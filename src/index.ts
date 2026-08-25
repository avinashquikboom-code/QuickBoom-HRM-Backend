import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import cron from 'node-cron';
import { apiReference } from '@scalar/express-api-reference';
import { specs } from './config/swagger';
import { metricsMiddleware } from './controllers/healthController';
import homeRoutes from './routes/homeRoutes';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import superAdminRoutes from './routes/superAdminRoutes';
import employeeRoutes from './routes/employee/employeeRoutes';
import employeeLegacyRoutes from './routes/employee/employeeLegacyRoutes';
import salesLegacyRoutes from './routes/sales/salesLegacyRoutes';
import employeeCommissionRoutes from './routes/employee/employeeCommissionRoutes';
import commissionRoutes from './routes/commissionRoutes';
import permissionRoutes from './routes/permissionRoutes';
import settingsRoutes from './routes/settingsRoutes';
import hrRoutes from './routes/hr/hrRoutes';
import taskRoutes from './routes/taskRoutes';
import healthRoutes from './routes/healthRoutes';
import mobileAuthRoutes from './routes/mobile/mobileAuthRoutes';
import mobileAttendanceRoutes from './routes/mobile/mobileAttendanceRoutes';
import mobileLeaveRoutes from './routes/mobile/mobileLeaveRoutes';
import firebaseNotificationRoutes from './routes/mobile/firebaseNotificationRoutes';
import mobilePayrollRoutes from './routes/mobile/mobilePayrollRoutes';
import payrollRoutes from './routes/payrollRoutes';
import attendanceRoutes from './routes/attendanceRoutes';
import mobileTrackingRoutes from './routes/mobile/mobileTrackingRoutes';
import mobileGeofenceRoutes from './routes/mobile/mobileGeofenceRoutes';
import mobileLeaveBalanceRoutes from './routes/mobile/mobileLeaveBalanceRoutes';
import mobileDistanceRoutes from './routes/mobile/mobileDistanceRoutes';
import remoteWorkRoutes from './routes/remoteWorkRoutes';
import shiftRuleRoutes from './routes/shiftRuleRoutes';
import mobileComprehensiveAttendanceRoutes from './routes/mobile/mobileComprehensiveAttendanceRoutes';
import mobileNotificationRoutes from './routes/mobile/mobileNotificationRoutes';
import upcomingRoutes from './routes/mobile/upcomingRoutes';
import mobileCommissionRoutes from './routes/mobile/mobileCommissionRoutes';
import mobileTaskRoutes from './routes/mobile/mobileTaskRoutes';
import mobileStoreRoutes from './routes/mobile/mobileStoreRoutes';
import mobileDocumentRoutes from './routes/mobile/mobileDocumentRoutes';
import mobileHolidayRoutes from './routes/mobile/mobileHolidayRoutes';
import mobileFeatureAccessRoutes from './routes/mobile/mobileFeatureAccessRoutes';
import mobileEmployeeTaskRoutes from './routes/mobile/mobileEmployeeTaskRoutes';
import mobileHrTaskRoutes from './routes/mobile/mobileHrTaskRoutes';
import leaveBalanceRoutes from './routes/leaveBalanceRoutes';
import policyRoutes from './routes/policyRoutes';
import realtimeLeaveRoutes from './routes/realtimeLeaveRoutes';
import attendanceGenerationPolicyRoutes from './routes/attendanceGenerationPolicyRoutes';
import comprehensiveAttendanceRoutes from './routes/comprehensiveAttendanceRoutes';
import attendanceCorrectionRoutes from './routes/attendanceCorrectionRoutes';
import deviceRoutes from './routes/deviceRoutes';
import breakRoutes from './routes/breakRoutes';
import shiftRequestRoutes from './routes/shiftRequestRoutes';
import locationTrackingRoutes from './routes/locationTrackingRoutes';
import salaryRoutes from './routes/salaryRoutes';
import resetRoutes from './routes/resetRoutes';
import uploadRoutes from './routes/uploadRoutes';
import accessRequestRoutes from './routes/accessRequestRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { authenticateToken } from './middlewares/authMiddleware';
import { initializeFirebase, initializeFirebaseFromDb } from './config/firebase';
import WebSocketService from './services/websocketService';
import { setWebSocketInstance } from './utils/websocketSingleton';
import { prisma, ensureDatabaseConstraints } from './utils/db';
import { Role } from '@prisma/client';
import { syncHopkidEmployees } from './utils/employeeSync';
import { syncHopkidSales } from './utils/salesSync';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

import path from 'path';

app.use(cors());
// Configure larger limit for base64 profile avatar images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure uploads directory structure exists on startup
import fs from 'fs';
const uploadsBase = path.join(process.cwd(), 'uploads', 'receipts');
if (!fs.existsSync(uploadsBase)) {
  fs.mkdirSync(uploadsBase, { recursive: true });
}

// Serve static upload files (public access, no auth)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/uploads', uploadRoutes);
app.use('/api/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/api/uploads', uploadRoutes);

// Apply metrics middleware to track all requests
app.use(metricsMiddleware);

// Initialize Firebase (env/file sync first, then DB integrations async)
try {
  initializeFirebase();
  initializeFirebaseFromDb().then(() => {
    console.log('✅ Firebase initialized from DB integrations successfully');
  }).catch((err: any) => {
    console.warn('⚠️ Firebase DB initialization warning:', err);
  });
} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
}

app.use('/api/public/users',async (req,res)=>{
  const db = await prisma.employee.findMany({take: 10});
  console.log(db);
  res.json({
    success:true,
    data:db
  })
})

// Raw OpenAPI JSON endpoint (must be before UI)
app.get('/api-docs/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

app.use('/scalar-docs', apiReference({
  spec: {
    content: specs,
  },
  theme: 'default',
  customCss: `
    .scalar-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
  `,
  metaData: {
    title: 'HRM API Documentation',
    description: 'Comprehensive API endpoints for HRM applications (including Web, Admin, and Mobile)',
  }
}));

import commissionReportController from './controllers/commissionReportController';
import dashboardController from './controllers/dashboardController';

import activityLogsRoutes from './routes/activityLogsRoutes';

// Routes
app.use('/api', homeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin/activity-logs', activityLogsRoutes);
app.use('/api/admin/commission', commissionReportController);
app.use('/api/admin/dashboard', dashboardController);
app.use('/api/admin', adminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/employee/tasks', mobileEmployeeTaskRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/Employee', employeeLegacyRoutes);
app.use('/api/Sales', salesLegacyRoutes);
app.use('/api/employee/commission', employeeCommissionRoutes);
app.use('/api/commission', commissionRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/hopkid', webhookRoutes);
app.use('/webhook', webhookRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/hopkid', webhookRoutes);
app.use('/api/mobile/notifications', mobileNotificationRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/mobile/permissions', permissionRoutes);
app.use('/api/mobile/employee-permissions', permissionRoutes);
app.use('/api/hr/employee-permissions', permissionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/hr/tasks', mobileHrTaskRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/leave-balance', leaveBalanceRoutes);
app.use('/api/realtime/leave', realtimeLeaveRoutes);
app.use('/api/attendance', comprehensiveAttendanceRoutes);
app.use('/api', attendanceGenerationPolicyRoutes);
app.use('/api', policyRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/breaks', breakRoutes);
app.use('/api', shiftRequestRoutes);
app.use('/api/mobile/location', locationTrackingRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api', resetRoutes);
app.use('/api', remoteWorkRoutes);
app.use('/api', shiftRuleRoutes);
import featureAccessRoutes from './routes/featureAccessRoutes';

import { downloadExpenseReceiptPDF } from './controllers/hr/hrController';
import { getSalaryStructureByEmployeeId, getMySalaryStructure, updateSalaryStructureById, getSalarySlip } from './controllers/salaryController';

app.use('/api', attendanceCorrectionRoutes);
app.use('/api', featureAccessRoutes);

// Salary structure & slip route aliases for admin edit and mobile wallet
app.get('/api/admin/employees/:employeeId/salary-structure', authenticateToken, getSalaryStructureByEmployeeId);
app.patch('/api/admin/employees/:employeeId/salary-structure', authenticateToken, updateSalaryStructureById);
app.put('/api/admin/employees/:employeeId/salary-structure', authenticateToken, updateSalaryStructureById);
app.get('/api/mobile/salary/structure', authenticateToken, getMySalaryStructure);
app.get('/api/mobile/salary/slip', authenticateToken, getSalarySlip);

// On-demand Expense Receipt PDF endpoints
app.get('/api/expense-claim/:id/receipt/pdf', authenticateToken, downloadExpenseReceiptPDF);
app.get('/api/expense/:id/receipt/pdf', authenticateToken, downloadExpenseReceiptPDF);
app.get('/api/employee/expenses/:id/receipt/pdf', authenticateToken, downloadExpenseReceiptPDF);
// Scalar documentation fallback
app.get('/scalar-docs', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HRM API Documentation</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest"></script>
      <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .loading { 
          display: flex; 
          justify-content: center; 
          align-items: center; 
          height: 100vh; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-size: 18px;
        }
      </style>
    </head>
    <body>
      <div id="scalar-api-reference"></div>
      <script>
        // Initialize Scalar API Reference
        ScalarApiReference.create({
          spec: {
            url: '/api-docs/swagger.json'
          },
          configuration: {
            baseServerURL: 'http://69.62.80.20:3000',
            darkMode: false,
            hideDownloadButton: false,
            hideTestButton: false
          },
          theme: 'default',
          customCss: \`
            .scalar-header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
          \`
        }).catch(error => {
          console.error('Scalar initialization failed:', error);
          document.body.innerHTML = '<div class="loading">Loading API Documentation...</div>';
        });
      </script>
      <div class="loading" id="loading">Loading API Documentation...</div>
    </body>
    </html>
  `);
});

// Mobile API Routes
app.use('/api/mobile/auth', mobileAuthRoutes);
app.use('/api/mobile/attendance', mobileAttendanceRoutes);
app.use('/api/mobile/leave', mobileLeaveRoutes);
app.use('/api/mobile/firebase', firebaseNotificationRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/mobile/payroll', mobilePayrollRoutes);
app.use('/api/mobile/tracking', mobileTrackingRoutes);
app.use('/api/mobile/geofence', mobileGeofenceRoutes);
app.use('/api/mobile/leave-balance', mobileLeaveBalanceRoutes);
app.use('/api/mobile/distance', mobileDistanceRoutes);
app.use('/api/mobile/attendance/comprehensive', mobileComprehensiveAttendanceRoutes);
app.use('/api/mobile/dashboard', upcomingRoutes);
app.use('/api/mobile/commission', mobileCommissionRoutes);
app.use('/api/mobile/tasks', mobileTaskRoutes);
app.use('/api/mobile/store', mobileStoreRoutes);
app.use('/api/mobile/holidays', mobileHolidayRoutes);
app.use('/api/mobile/features', mobileFeatureAccessRoutes);
app.use('/api', accessRequestRoutes);

app.get('/api/holidays', authenticateToken, async (req, res) => {
  try {
    const holidays = await prisma.holiday.findMany({
      orderBy: { date: 'asc' }
    });
    res.json({
      success: true,
      holidays: holidays.map(h => ({
        name: h.name,
        date: h.date.toISOString().split('T')[0],
        isPublic: h.isPublic
      })),
      sundaysAreHolidays: true
    });
  } catch (error) {
    console.error('Fetch holidays error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch holidays.' });
  }
});

const host = process.env.HOST || '0.0.0.0';

// Create HTTP server for WebSocket support
const server = createServer(app);

// Initialize WebSocket service
const webSocketService = new WebSocketService(server);
setWebSocketInstance(webSocketService);

async function initRolePermissions() {
  const defaultSuperAdminPerms = {
    'sa-dashboard': true,
    'sa-companies': true,
    'sa-subscriptions': true,
    'sa-location': true,
    'sa-location-new': true,
    'sa-settings': true,
    'sa-user-rights': true,
    'sa-profile': true,
  };

  const defaultPlatformAdminPerms = {
    'pa-hr': true,
    'pa-employee-rights': true,
    'pa-employees': true,
    'pa-leave': true,
    'pa-tasks': true,
    'pa-payroll': true,
    'pa-attendance': true,
    'pa-policies': true,
    'pa-analytics': true,
    'pa-reports': true,
    'pa-notifications': true,
    'pa-profile': true,
  };

  const defaultEmployeePerms = {
    'em-dashboard': true,
    'em-attendance': true,
    'em-leave': true,
    'em-tasks': true,
    'em-notifications': true,
    'em-profile': true,
  };

  const rolesToInitialize = [
    { role: Role.SUPER_ADMIN, perms: defaultSuperAdminPerms },
    { role: Role.ADMIN, perms: defaultSuperAdminPerms },
    { role: Role.HR, perms: defaultPlatformAdminPerms },
    { role: Role.PLATFORM_ADMIN, perms: defaultPlatformAdminPerms },
    { role: Role.EMPLOYEE, perms: defaultEmployeePerms },
  ];

  for (const item of rolesToInitialize) {
    try {
      const existing = await prisma.rolePermission.findUnique({
        where: { role: item.role },
      });

      if (!existing) {
        await prisma.rolePermission.create({
          data: {
            role: item.role,
            permissions: item.perms,
          },
        });
        console.log(`✅ [Startup Patch] Created default role permissions for ${item.role}`);
      } else {
        const currentPerms = (existing.permissions || {}) as Record<string, any>;
        let needsUpdate = false;
        
        for (const [key, value] of Object.entries(item.perms)) {
          if (currentPerms[key] !== value) {
            currentPerms[key] = value;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await prisma.rolePermission.update({
            where: { role: item.role },
            data: { permissions: currentPerms },
          });
          console.log(`✅ [Startup Patch] Updated role permissions for ${item.role} to include missing defaults.`);
        }
      }
    } catch (err) {
      console.error(`❌ [Startup Patch] Failed to initialize role permissions for ${item.role}:`, err);
    }
  }
}

import { initFeatureExpiryCron } from './scripts/featureExpiryCron';
import { initPayrollCron } from './services/payrollCronService';
import { initAutoPunchOutCron } from './services/autoPunchOutService';

// Initialize cron jobs
initFeatureExpiryCron();
initPayrollCron();
initAutoPunchOutCron();

server.listen(port, host, () => {
  console.log('Server is running at http://' + host + ':' + port);
  console.log(' Scalar Docs: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '/scalar-docs');
  console.log('🔌 WebSocket Real-time Updates: Enabled');
  console.log('🚀 HRM Backend is ready!\n');

  // Automatically ensure all active/existing offices have at least 25m radius
  prisma.office.updateMany({
    where: {
      maxPunchRadiusMeters: {
        lt: 25
      }
    },
    data: {
      maxPunchRadiusMeters: 25,
      idealRadiusMeters: 25
    }
  })
  .then(result => {
    if (result.count > 0) {
      console.log(`✅ [Startup Patch] Updated ${result.count} office(s) geofence radius to 25m.`);
    } else {
      console.log(`ℹ️ [Startup Patch] All offices already have geofence radius >= 25m.`);
    }
  })
  .catch(err => {
    console.error('❌ [Startup Patch] Failed to update office geofence radius on startup:', err);
  });

  // Initialize Database Constraints startup patch
  ensureDatabaseConstraints()
    .catch(err => console.error('❌ [Startup Patch] Database constraints initialization failed:', err));

  // Initialize Role Permissions startup patch
  initRolePermissions()
    .then(() => console.log('✅ [Startup Patch] Role permissions verified/initialized.'))
    .catch(err => console.error('❌ [Startup Patch] Role permissions initialization failed:', err));

  // HopKid employees are now synchronized via Webhook events (EMPLOYEE_CREATED, EMPLOYEE_UPDATED, EMPLOYEE_DELETED)
  // Background API polling disabled to prevent rate limits and latency
  console.log('ℹ️ [Startup] HopKid Employee synchronization active via Real-time Webhooks');

  // On day start, check holidays
  cron.schedule('0 0 * * *', async () => { // Midnight IST
    try {
      console.log('🔄 [Background Schedule] Checking for paid holidays...');
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Strip time for exact date match
      
      const holiday = await prisma.holiday.findFirst({
        where: { date: today }
      });
      
      if (holiday) {
        console.log(`🎉 [Holiday] Today is a paid holiday: ${holiday.name}`);
        // Get all active employees
        const employees = await prisma.employee.findMany({ where: { status: 'active' } });
        
        for (const emp of employees) {
          // Check if attendance already exists to prevent duplicates
          const dateStr = today.toISOString().split('T')[0];
          const existing = await prisma.attendance.findFirst({
            where: { employeeId: emp.id, date: dateStr }
          });

          if (!existing) {
            // Create PAID attendance (no punch required)
            await prisma.attendance.create({
              data: {
                employeeId: emp.id,
                date: dateStr,
                status: 'PAID',
                checkIn: null,
                checkOut: null,
                notes: holiday.name
              }
            });
          }
        }
      }
    } catch (err) {
      console.error('❌ [Background Schedule] Error checking holidays:', err);
    }
  });
});

// Set server timeout to 60 seconds to handle slow mobile requests
server.timeout = 60000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// webSocketService is available via getWebSocketInstance() from utils/websocketSingleton
