import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { apiReference } from '@scalar/express-api-reference';
import swaggerUi from 'swagger-ui-express';
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
import firebaseNotificationRoutes from './routes/mobile/firebaseNotificationRoutes';
import { initializeFirebase } from './config/firebase';

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

// API Documentation Routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'QuickBoom HRM API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
  },
}));

app.use('/scalar-docs', apiReference({
  spec: {
    content: specs,
  },
  theme: 'default',
  customCss: `
    .scalar-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
  `,
}));

// Mobile-specific Scalar documentation
app.use('/mobile-docs', apiReference({
  spec: {
    content: specs,
  },
  theme: 'default',
  customCss: `
    .scalar-header {
      background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
    }
    .scalar-header h1 {
      color: white;
    }
  `,
  metaData: {
    title: 'QuickBoom Mobile API Documentation',
    description: 'Mobile-specific API endpoints for QuickBoom HRM mobile applications',
  }
}));

// Routes
app.use('/', homeRoutes);
app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/hr', hrRoutes);

// Mobile API Routes
app.use('/api/mobile/auth', mobileAuthRoutes);
app.use('/api/mobile/attendance', mobileAttendanceRoutes);
app.use('/api/mobile/firebase', firebaseNotificationRoutes);

const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  console.log('Server is running at http://' + host + ':' + port);
});
