import { Router } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import {
  createAttendanceGenerationPolicy,
  getAllAttendanceGenerationPolicies,
  getAttendanceGenerationPolicyById,
  updateAttendanceGenerationPolicy,
  deleteAttendanceGenerationPolicy,
  generateAttendanceCalendar,
  generateCalendarForMonth,
} from '../controllers/attendanceGenerationPolicyController';

const router = Router();

// ─── Attendance Generation Policy Routes ─────────────────────────────────────

router.post('/attendance-generation-policies', (req: AuthenticatedRequest, res, next) => {
  createAttendanceGenerationPolicy(req, res);
});
router.get('/attendance-generation-policies', (req: AuthenticatedRequest, res, next) => {
  getAllAttendanceGenerationPolicies(req, res);
});
router.get('/attendance-generation-policies/:id', (req: AuthenticatedRequest, res, next) => {
  getAttendanceGenerationPolicyById(req, res);
});
router.put('/attendance-generation-policies/:id', (req: AuthenticatedRequest, res, next) => {
  updateAttendanceGenerationPolicy(req, res);
});
router.delete('/attendance-generation-policies/:id', (req: AuthenticatedRequest, res, next) => {
  deleteAttendanceGenerationPolicy(req, res);
});
router.post('/attendance-generation-policies/:policyId/generate', (req: AuthenticatedRequest, res, next) => {
  generateAttendanceCalendar(req, res);
});
router.post('/attendance-calendar/generate', (req: AuthenticatedRequest, res, next) => {
  generateCalendarForMonth(req, res);
});

export default router;
