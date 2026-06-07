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
import leaveBalanceRoutes from './routes/leaveBalanceRoutes';
import realtimeLeaveRoutes from './routes/realtimeLeaveRoutes';
import comprehensiveAttendanceRoutes from './routes/comprehensiveAttendanceRoutes';
import { initializeFirebase } from './config/firebase';
import WebSocketService from './services/websocketService';

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
    title: 'QuickBoom HRM API Documentation',
    description: 'Comprehensive API endpoints for QuickBoom HRM applications (including Web, Admin, and Mobile)',
  }
}));

// Routes
app.use('/', homeRoutes);
app.use('/health', healthRoutes);
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
      <title>QuickBoom HRM API Documentation</title>
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
            baseServerURL: 'https://quickboom-hrm-backend.onrender.com',
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

const host = process.env.HOST || '0.0.0.0';

// Create HTTP server for WebSocket support
const server = createServer(app);

// Initialize WebSocket service
const webSocketService = new WebSocketService(server);

server.listen(port, host, () => {
  console.log('Server is running at http://' + host + ':' + port);
  console.log(' Scalar Docs: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '/scalar-docs');
  console.log('🔌 WebSocket Real-time Updates: Enabled');
  console.log('🚀 QuickBoom HRM Backend is ready!\n');
});

// Export WebSocket service for use in controllers
export { webSocketService };
