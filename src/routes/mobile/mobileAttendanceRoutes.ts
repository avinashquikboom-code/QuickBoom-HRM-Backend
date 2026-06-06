import { Router } from 'express';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { roleMiddleware } from '../../middlewares/roleMiddleware';
import {
  mobilePunchIn,
  mobilePunchOut,
  startBreak,
  endBreak,
  getTodayAttendance,
  getAttendanceHistory,
  getAttendanceStats,
  downloadMyAttendanceReport,
  downloadAttendanceReport,
  requestAttendanceCorrection
} from '../../controllers/mobile/mobileAttendanceController';

const router = Router();

// Apply auth middleware to protect all mobile attendance routes
router.use(authMiddleware);

// Restrict access to employees and HR managers
const employeeRoles = ['EMPLOYEE', 'HR', 'SUPER_ADMIN', 'ADMIN'];
router.use(roleMiddleware(employeeRoles));

/**
 * @swagger
 * /api/mobile/attendance/punch-in:
 *   post:
 *     summary: Punch in for work (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - latitude
 *               - longitude
 *             properties:
 *               latitude:
 *                 type: number
 *                 description: Current latitude of the user
 *               longitude:
 *                 type: number
 *                 description: Current longitude of the user
 *               notes:
 *                 type: string
 *                 description: Optional notes for punch in
 *               photo:
 *                 type: string
 *                 description: Base64 encoded photo (optional)
 *     responses:
 *       200:
 *         description: Punch in successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     checkInTime:
 *                       type: string
 *                       format: date-time
 *                     location:
 *                       type: object
 *                       properties:
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                     office:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         address:
 *                           type: string
 *                     status:
 *                       type: string
 *                     notes:
 *                       type: string
 *       400:
 *         description: Bad request (already punched in, outside geofence)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/punch-in', mobilePunchIn);

/**
 * @swagger
 * /api/mobile/attendance/punch-out:
 *   post:
 *     summary: Punch out from work (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *                 description: Current latitude of the user
 *               longitude:
 *                 type: number
 *                 description: Current longitude of the user
 *               notes:
 *                 type: string
 *                 description: Optional notes for punch out
 *     responses:
 *       200:
 *         description: Punch out successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     checkInTime:
 *                       type: string
 *                       format: date-time
 *                     checkOutTime:
 *                       type: string
 *                       format: date-time
 *                     workDuration:
 *                       type: object
 *                       properties:
 *                         hours:
 *                           type: integer
 *                         minutes:
 *                           type: integer
 *                         totalMinutes:
 *                           type: integer
 *                     location:
 *                       type: object
 *                       properties:
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                     status:
 *                       type: string
 *       400:
 *         description: Bad request (no active punch in, still on break)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/punch-out', mobilePunchOut);

/**
 * @swagger
 * /api/mobile/attendance/break/start:
 *   post:
 *     summary: Start break (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Break started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     breakStartTime:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: string
 *       400:
 *         description: Bad request (no active attendance, already on break)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/break/start', startBreak);

/**
 * @swagger
 * /api/mobile/attendance/break/end:
 *   post:
 *     summary: End break (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Break ended successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     breakEndTime:
 *                       type: string
 *                       format: date-time
 *                     breakDuration:
 *                       type: object
 *                       properties:
 *                         minutes:
 *                           type: integer
 *                         seconds:
 *                           type: integer
 *                     totalBreakTimeToday:
 *                       type: integer
 *                     status:
 *                       type: string
 *       400:
 *         description: Bad request (no active break)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/break/end', endBreak);

/**
 * @swagger
 * /api/mobile/attendance/today:
 *   get:
 *     summary: Get today's attendance status (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today's attendance status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       format: date
 *                     status:
 *                       type: string
 *                       enum: [PRESENT, ABSENT, LATE, HALF_DAY, LEAVE, WEEKEND, HOLIDAY]
 *                     checkIn:
 *                       type: string
 *                       format: date-time
 *                     checkOut:
 *                       type: string
 *                       format: date-time
 *                     isOnBreak:
 *                       type: boolean
 *                     breakStartTime:
 *                       type: string
 *                       format: date-time
 *                     totalBreakSeconds:
 *                       type: integer
 *                     notes:
 *                       type: string
 *                     location:
 *                       type: object
 *                       properties:
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                     office:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         address:
 *                           type: string
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                         maxRadius:
 *                           type: number
 *                     canPunchIn:
 *                       type: boolean
 *                     canPunchOut:
 *                       type: boolean
 *                     canStartBreak:
 *                       type: boolean
 *                     canEndBreak:
 *                       type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/today', getTodayAttendance);

/**
 * @swagger
 * /api/mobile/attendance/history:
 *   get:
 *     summary: Get attendance history (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of records per page
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Month number (1-12)
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Year
 *     responses:
 *       200:
 *         description: Attendance history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     attendances:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           date:
 *                             type: string
 *                             format: date
 *                           status:
 *                             type: string
 *                           checkIn:
 *                             type: string
 *                             format: date-time
 *                           checkOut:
 *                             type: string
 *                             format: date-time
 *                           workDuration:
 *                             type: object
 *                             properties:
 *                               hours:
 *                                 type: integer
 *                               minutes:
 *                                 type: integer
 *                               totalMinutes:
 *                                 type: integer
 *                           breakTime:
 *                             type: object
 *                             properties:
 *                               minutes:
 *                                 type: integer
 *                               seconds:
 *                                 type: integer
 *                           notes:
 *                             type: string
 *                           location:
 *                             type: object
 *                             properties:
 *                               latitude:
 *                                 type: number
 *                               longitude:
 *                                 type: number
 *                           office:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                               address:
 *                                 type: string
 *                           isFingerprintCheckIn:
 *                             type: boolean
 *                           isFingerprintCheckOut:
 *                             type: boolean
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         totalPages:
 *                           type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/history', getAttendanceHistory);

/**
 * @swagger
 * /api/mobile/attendance/stats:
 *   get:
 *     summary: Get attendance statistics (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Month number (1-12)
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Year
 *     responses:
 *       200:
 *         description: Attendance statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     period:
 *                       type: string
 *                     totalDays:
 *                       type: integer
 *                     presentDays:
 *                       type: integer
 *                     absentDays:
 *                       type: integer
 *                     lateDays:
 *                       type: integer
 *                     halfDays:
 *                       type: integer
 *                     leaveDays:
 *                       type: integer
 *                     attendanceRate:
 *                       type: string
 *                     totalWorkTime:
 *                       type: object
 *                       properties:
 *                         hours:
 *                           type: integer
 *                         minutes:
 *                           type: integer
 *                         totalMinutes:
 *                           type: integer
 *                     totalBreakTime:
 *                       type: object
 *                       properties:
 *                         hours:
 *                           type: integer
 *                         minutes:
 *                           type: integer
 *                         totalMinutes:
 *                           type: integer
 *                     averageWorkHoursPerDay:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/stats', getAttendanceStats);

/**
 * @swagger
 * /api/mobile/attendance/my-report/download:
 *   get:
 *     summary: Download the logged-in employee's own attendance report as PDF (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           format: YYYY-MM
 *           example: "2024-01"
 *         description: Target month for the report (defaults to current month)
 *     responses:
 *       200:
 *         description: PDF file stream of the employee's attendance report
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Server error
 */
router.get('/my-report/download', downloadMyAttendanceReport);

/**
 * @swagger
 * /api/mobile/attendance/report/download:
 *   get:
 *     summary: Download an attendance report as PDF for HR/Admin (all employees or specific employee)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           format: YYYY-MM
 *           example: "2024-01"
 *         description: Target month for the report (defaults to current month)
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: integer
 *           example: 1
 *         description: 'Optional: Specific employee ID for individual report (HR/Admin only)'
 *     responses:
 *       200:
 *         description: PDF file stream of the attendance report
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied. HR or Admin role required.
 *       500:
 *         description: Server error
 */
router.get('/report/download', downloadAttendanceReport);

/**
 * @swagger
 * /api/mobile/attendance/correction:
 *   post:
 *     summary: Request attendance correction (Mobile)
 *     tags: [Mobile - Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - attendanceId
 *               - correctionType
 *               - reason
 *             properties:
 *               attendanceId:
 *                 type: integer
 *                 example: 1
 *                 description: ID of the attendance record to correct
 *               correctionType:
 *                 type: string
 *                 enum: [CHECK_IN, CHECK_OUT, BOTH]
 *                 example: "CHECK_IN"
 *                 description: Type of correction requested
 *               requestedCheckIn:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-01-15T09:30:00Z"
 *                 description: Requested check-in time (for CHECK_IN and BOTH types)
 *               requestedCheckOut:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-01-15T18:30:00Z"
 *                 description: Requested check-out time (for CHECK_OUT and BOTH types)
 *               reason:
 *                 type: string
 *                 example: "Was stuck in traffic"
 *                 description: Reason for correction request
 *     responses:
 *       200:
 *         description: Correction request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Attendance correction request submitted successfully."
 *                 correctionRequest:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     status:
 *                       type: string
 *                       example: "PENDING"
 *       400:
 *         description: Bad request (missing required fields)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Attendance record not found
 *       500:
 *         description: Server error
 */
router.post('/correction', requestAttendanceCorrection);

export default router;
