import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import {
  canExportPayrollGovernance,
  generatePayrollGovernanceFile,
  isPayrollExportFormat,
} from '../utils/payrollGovernanceExport';

export const exportPayrollGovernance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }
    if (!canExportPayrollGovernance(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permissions to export payroll governance data.',
      });
      return;
    }

    const formatRaw = String(req.query.format || 'pdf').toLowerCase();
    if (!isPayrollExportFormat(formatRaw)) {
      res.status(400).json({
        success: false,
        message: 'Invalid format. Payroll governance export is available as PDF only.',
      });
      return;
    }

    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const advanceStatus = typeof req.query.advanceStatus === 'string' ? req.query.advanceStatus : undefined;

    const file = await generatePayrollGovernanceFile({ month, search, advanceStatus });

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  } catch (error) {
    console.error('Export payroll governance error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to export payroll governance data.',
      });
    }
  }
};
