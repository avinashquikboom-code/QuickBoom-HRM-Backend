import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { apiReference } from '@scalar/express-api-reference';
import { specs } from './config/swagger';
import { metricsMiddleware } from './controllers/healthController';
import homeRoutes from './routes/homeRoutes';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import superAdminRoutes from './routes/superAdminRoutes';
import employeeRoutes from './routes/employee/employeeRoutes';
import permissionRoutes from './routes/permissionRoutes';
import settingsRoutes from './routes/settingsRoutes';
import hrRoutes from './routes/hr/hrRoutes';
import healthRoutes from './routes/healthRoutes';
import mobileAuthRoutes from './routes/mobile/mobileAuthRoutes';
import mobileAttendanceRoutes from './routes/mobile/mobileAttendanceRoutes';
import mobileLeaveRoutes from './routes/mobile/mobileLeaveRoutes';
import firebaseNotificationRoutes from './routes/mobile/firebaseNotificationRoutes';
import mobilePayrollRoutes from './routes/mobile/mobilePayrollRoutes';
import mobileTrackingRoutes from './routes/mobile/mobileTrackingRoutes';
import mobileGeofenceRoutes from './routes/mobile/mobileGeofenceRoutes';
import mobileLeaveBalanceRoutes from './routes/mobile/mobileLeaveBalanceRoutes';
import mobileDistanceRoutes from './routes/mobile/mobileDistanceRoutes';
import mobileComprehensiveAttendanceRoutes from './routes/mobile/mobileComprehensiveAttendanceRoutes';
import mobileNotificationRoutes from './routes/mobile/mobileNotificationRoutes';
import upcomingRoutes from './routes/mobile/upcomingRoutes';
import leaveBalanceRoutes from './routes/leaveBalanceRoutes';
import realtimeLeaveRoutes from './routes/realtimeLeaveRoutes';
import comprehensiveAttendanceRoutes from './routes/comprehensiveAttendanceRoutes';
import { initializeFirebase } from './config/firebase';
import WebSocketService from './services/websocketService';
import { setWebSocketInstance } from './utils/websocketSingleton';
import { prisma } from './utils/db';
import { Role } from '@prisma/client';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
// Configure larger limit for base64 profile avatar images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply metrics middleware to track all requests
app.use(metricsMiddleware);

// Initialize Firebase
try {
  initializeFirebase();
  console.log('✅ Firebase initialized successfully');
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

// Routes
app.use('/api', homeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/mobile/notifications', mobileNotificationRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/leave-balance', leaveBalanceRoutes);
app.use('/api/realtime/leave', realtimeLeaveRoutes);
app.use('/api/attendance', comprehensiveAttendanceRoutes);

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
            url: '/api-docs.json'
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
app.use('/api/mobile/payroll', mobilePayrollRoutes);
app.use('/api/mobile/tracking', mobileTrackingRoutes);
app.use('/api/mobile/geofence', mobileGeofenceRoutes);
app.use('/api/mobile/leave-balance', mobileLeaveBalanceRoutes);
app.use('/api/mobile/distance', mobileDistanceRoutes);
app.use('/api/mobile/attendance/comprehensive', mobileComprehensiveAttendanceRoutes);
app.use('/api/mobile/dashboard', upcomingRoutes);

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

  // Initialize Role Permissions startup patch
  initRolePermissions()
    .then(() => console.log('✅ [Startup Patch] Role permissions verified/initialized.'))
    .catch(err => console.error('❌ [Startup Patch] Role permissions initialization failed:', err));
});

// Set server timeout to 60 seconds to handle slow mobile requests
server.timeout = 60000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// webSocketService is available via getWebSocketInstance() from utils/websocketSingleton
