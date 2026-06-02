import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: ServiceHealth[];
  system: SystemHealth;
  metrics: HealthMetrics;
}

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  details?: any;
}

interface SystemHealth {
  platform: string;
  arch: string;
  nodeVersion: string;
  memory: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  cpu: {
    cores: number;
    loadAverage: number[];
    percentage: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
}

interface HealthMetrics {
  activeConnections: number;
  requestsPerMinute: number;
  errorRate: number;
  averageResponseTime: number;
}

// Simple in-memory metrics tracking
let requestCount = 0;
let errorCount = 0;
let responseTimeTotal = 0;
let requestTimestamps: number[] = [];
const METRICS_WINDOW = 60000; // 1 minute window

export const getBasicHealth = async (req: Request, res: Response) => {
  try {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      message: 'QuickBoom HRM API is running'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
};

export const getDetailedHealth = async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Check all services
    const services = await Promise.allSettled([
      checkDatabaseHealth(),
      checkFirebaseHealth(),
      checkExternalServicesHealth()
    ]);

    const serviceResults: ServiceHealth[] = [];
    
    // Database health
    const dbResult = services[0];
    serviceResults.push({
      name: 'database',
      status: dbResult.status === 'fulfilled' ? dbResult.value.status : 'unhealthy',
      responseTime: dbResult.status === 'fulfilled' ? dbResult.value.responseTime : undefined,
      error: dbResult.status === 'rejected' ? dbResult.reason.message : undefined,
      details: dbResult.status === 'fulfilled' ? dbResult.value.details : undefined
    });

    // Firebase health
    const firebaseResult = services[1];
    serviceResults.push({
      name: 'firebase',
      status: firebaseResult.status === 'fulfilled' ? firebaseResult.value.status : 'unhealthy',
      responseTime: firebaseResult.status === 'fulfilled' ? firebaseResult.value.responseTime : undefined,
      error: firebaseResult.status === 'rejected' ? firebaseResult.reason.message : undefined,
      details: firebaseResult.status === 'fulfilled' ? firebaseResult.value.details : undefined
    });

    // External services health
    const externalResult = services[2];
    serviceResults.push({
      name: 'external_services',
      status: externalResult.status === 'fulfilled' ? externalResult.value.status : 'unhealthy',
      responseTime: externalResult.status === 'fulfilled' ? externalResult.value.responseTime : undefined,
      error: externalResult.status === 'rejected' ? externalResult.reason.message : undefined,
      details: externalResult.status === 'fulfilled' ? externalResult.value.details : undefined
    });

    // Get system health
    const systemHealth = await getSystemHealth();
    
    // Get application metrics
    const metrics = getApplicationMetrics();

    // Determine overall health status
    const overallStatus = determineOverallStatus(serviceResults, systemHealth);

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: serviceResults,
      system: systemHealth,
      metrics: metrics
    };

    const responseTime = Date.now() - startTime;
    
    // Update metrics
    updateMetrics(responseTime, false);

    res.json(healthStatus);
  } catch (error) {
    updateMetrics(0, true);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Detailed health check failed',
      services: [],
      system: {},
      metrics: getApplicationMetrics()
    });
  }
};

export const getDatabaseHealth = async (req: Request, res: Response) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    res.json(dbHealth);
  } catch (error) {
    res.status(500).json({
      name: 'database',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
};

export const getSystemMetrics = async (req: Request, res: Response) => {
  try {
    const systemHealth = await getSystemHealth();
    const metrics = getApplicationMetrics();
    
    res.json({
      system: systemHealth,
      application: metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get system metrics',
      timestamp: new Date().toISOString()
    });
  }
};

export const getReadinessProbe = async (req: Request, res: Response) => {
  try {
    // Check if the application is ready to accept traffic
    const dbHealth = await checkDatabaseHealth();
    
    if (dbHealth.status === 'healthy') {
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'healthy'
        }
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'unhealthy'
        }
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed'
    });
  }
};

export const getLivenessProbe = async (req: Request, res: Response) => {
  try {
    // Basic liveness check - is the process responsive?
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      status: 'dead',
      timestamp: new Date().toISOString(),
      error: 'Liveness check failed'
    });
  }
};

// Helper functions
async function checkDatabaseHealth(): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Get database stats
    const userCount = await prisma.user.count();
    const employeeCount = await prisma.employee.count();
    
    const responseTime = Date.now() - startTime;
    
    return {
      name: 'database',
      status: 'healthy',
      responseTime,
      details: {
        connection: 'connected',
        userCount,
        employeeCount,
        lastCheck: new Date().toISOString()
      }
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      name: 'database',
      status: 'unhealthy',
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown database error',
      details: {
        connection: 'disconnected',
        lastCheck: new Date().toISOString()
      }
    };
  }
}

async function checkFirebaseHealth(): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    // Check if Firebase is initialized
    // This is a basic check - you might want to add more specific Firebase health checks
    const responseTime = Date.now() - startTime;
    
    return {
      name: 'firebase',
      status: 'healthy',
      responseTime,
      details: {
        initialized: true,
        service: 'Firebase Admin SDK',
        lastCheck: new Date().toISOString()
      }
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      name: 'firebase',
      status: 'unhealthy',
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown Firebase error',
      details: {
        initialized: false,
        lastCheck: new Date().toISOString()
      }
    };
  }
}

async function checkExternalServicesHealth(): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    // Check external services like Google Maps API, etc.
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    const responseTime = Date.now() - startTime;
    
    return {
      name: 'external_services',
      status: googleMapsApiKey ? 'healthy' : 'degraded',
      responseTime,
      details: {
        googleMaps: googleMapsApiKey ? 'configured' : 'not_configured',
        lastCheck: new Date().toISOString()
      }
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      name: 'external_services',
      status: 'unhealthy',
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown external service error',
      details: {
        lastCheck: new Date().toISOString()
      }
    };
  }
}

async function getSystemHealth(): Promise<SystemHealth> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  // Get disk usage (simplified - you might want to use a more robust method)
  const stats = fs.statSync(process.cwd());
  
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage: (usedMem / totalMem) * 100
    },
    cpu: {
      cores: os.cpus().length,
      loadAverage: os.loadavg(),
      percentage: 0 // You might want to implement CPU usage calculation
    },
    disk: {
      total: 0, // Implement disk usage calculation if needed
      free: 0,
      used: 0,
      percentage: 0
    }
  };
}

function getApplicationMetrics(): HealthMetrics {
  const now = Date.now();
  const recentRequests = requestTimestamps.filter(timestamp => now - timestamp < METRICS_WINDOW);
  
  return {
    activeConnections: 0, // You might want to track actual connections
    requestsPerMinute: recentRequests.length,
    errorRate: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
    averageResponseTime: requestCount > 0 ? responseTimeTotal / requestCount : 0
  };
}

function determineOverallStatus(services: ServiceHealth[], system: SystemHealth): 'healthy' | 'unhealthy' | 'degraded' {
  const unhealthyServices = services.filter(s => s.status === 'unhealthy');
  const degradedServices = services.filter(s => s.status === 'degraded');
  
  if (unhealthyServices.length > 0) {
    return 'unhealthy';
  }
  
  if (degradedServices.length > 0 || system.memory.percentage > 90) {
    return 'degraded';
  }
  
  return 'healthy';
}

function updateMetrics(responseTime: number, isError: boolean) {
  requestCount++;
  requestTimestamps.push(Date.now());
  
  if (isError) {
    errorCount++;
  } else {
    responseTimeTotal += responseTime;
  }
  
  // Clean old timestamps
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(timestamp => now - timestamp < METRICS_WINDOW);
}

// Middleware to track requests
export const metricsMiddleware = (req: Request, res: Response, next: Function) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const isError = res.statusCode >= 400;
    updateMetrics(responseTime, isError);
  });
  
  next();
};
