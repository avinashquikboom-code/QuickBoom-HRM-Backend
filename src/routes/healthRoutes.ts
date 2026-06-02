import { Router } from 'express';
import {
  getBasicHealth,
  getDetailedHealth,
  getDatabaseHealth,
  getSystemMetrics,
  getReadinessProbe,
  getLivenessProbe,
  metricsMiddleware
} from '../controllers/healthController';

const router = Router();

// Apply metrics middleware to track health check requests
router.use(metricsMiddleware);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Basic health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, unhealthy]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                 message:
 *                   type: string
 *       500:
 *         description: Service is unhealthy
 */
router.get('/', getBasicHealth);

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     summary: Comprehensive health check with all services and system metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Detailed health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, unhealthy, degraded]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                 version:
 *                   type: string
 *                 environment:
 *                   type: string
 *                 services:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceHealth'
 *                 system:
 *                   $ref: '#/components/schemas/SystemHealth'
 *                 metrics:
 *                   $ref: '#/components/schemas/HealthMetrics'
 *       500:
 *         description: Health check failed
 */
router.get('/detailed', getDetailedHealth);

/**
 * @swagger
 * /health/database:
 *   get:
 *     summary: Database health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database health status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceHealth'
 *       500:
 *         description: Database health check failed
 */
router.get('/database', getDatabaseHealth);

/**
 * @swagger
 * /health/metrics:
 *   get:
 *     summary: System and application metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: System metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 system:
 *                   $ref: '#/components/schemas/SystemHealth'
 *                 application:
 *                   $ref: '#/components/schemas/HealthMetrics'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Failed to get metrics
 */
router.get('/metrics', getSystemMetrics);

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Readiness probe for container orchestration
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application is ready to accept traffic
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ready, not_ready]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 checks:
 *                   type: object
 *       503:
 *         description: Application is not ready
 */
router.get('/ready', getReadinessProbe);

/**
 * @swagger
 * /health/live:
 *   get:
 *     summary: Liveness probe for container orchestration
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Application is alive
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [alive, dead]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *       500:
 *         description: Application is not responding
 */
router.get('/live', getLivenessProbe);

export default router;
