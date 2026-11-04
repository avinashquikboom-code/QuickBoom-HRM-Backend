/**
 * HopKid Report Admin Controller
 * Provides authenticated Admin Panel endpoints for HopKid filter lists and report queries.
 */

import { Request, Response } from 'express';
import { hopkidFilterService } from '../../services/hopkidReport/hopkidFilterService';
import {
  hopkidReportService,
  REPORT_DEFINITIONS,
  ReportCategory,
} from '../../services/hopkidReport/hopkidReportService';
import { HopKidReportError } from '../../services/hopkidReport/hopkidApiClient';

function handleError(res: Response, error: any, defaultMsg = 'HopKid Report request failed') {
  if (error instanceof HopKidReportError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      errorCode: error.errorCode,
      upstreamMessage: error.upstreamMessage,
    });
  }

  console.error('[HopKidReportController] Unexpected error:', error);
  return res.status(500).json({
    success: false,
    message: error?.message || defaultMsg,
    errorCode: 'ERR_INTERNAL_SERVER',
  });
}

export class HopKidReportController {
  // ─── Filter List Handlers ──────────────────────────────────────────────────────────

  public static async getBranches(req: Request, res: Response) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await hopkidFilterService.getBranches(forceRefresh);
      return res.json({ success: true, data });
    } catch (error) {
      return handleError(res, error, 'Failed to fetch branch filter list');
    }
  }

  public static async getBrands(req: Request, res: Response) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await hopkidFilterService.getBrands(forceRefresh);
      return res.json({ success: true, data });
    } catch (error) {
      return handleError(res, error, 'Failed to fetch brand filter list');
    }
  }

  public static async getCategories(req: Request, res: Response) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await hopkidFilterService.getCategories(forceRefresh);
      return res.json({ success: true, data });
    } catch (error) {
      return handleError(res, error, 'Failed to fetch category filter list');
    }
  }

  public static async getSubCategories(req: Request, res: Response) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await hopkidFilterService.getSubCategories(forceRefresh);
      return res.json({ success: true, data });
    } catch (error) {
      return handleError(res, error, 'Failed to fetch subcategory filter list');
    }
  }

  public static async getDepartments(req: Request, res: Response) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await hopkidFilterService.getDepartments(forceRefresh);
      return res.json({ success: true, data });
    } catch (error) {
      return handleError(res, error, 'Failed to fetch department filter list');
    }
  }

  public static async getSuppliers(req: Request, res: Response) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await hopkidFilterService.getSuppliers(forceRefresh);
      return res.json({ success: true, data });
    } catch (error) {
      return handleError(res, error, 'Failed to fetch supplier filter list');
    }
  }

  public static async refreshFilters(req: Request, res: Response) {
    try {
      const counts = await hopkidFilterService.refreshAll();
      return res.json({
        success: true,
        message: 'All HopKid filter caches have been refreshed successfully',
        data: counts,
      });
    } catch (error) {
      return handleError(res, error, 'Failed to refresh filter lists from HopKid');
    }
  }

  // ─── Metadata Handler ──────────────────────────────────────────────────────────────

  public static async listReports(req: Request, res: Response) {
    try {
      const category = req.query.category as ReportCategory | undefined;
      const reports = hopkidReportService.getReportList(category);
      return res.json({ success: true, data: reports });
    } catch (error) {
      return handleError(res, error, 'Failed to retrieve report list');
    }
  }

  // ─── Report Execution Runner ───────────────────────────────────────────────────────

  public static createReportHandler(reportKey: string) {
    return async (req: Request, res: Response) => {
      try {
        const payload = {
          ...req.query,
          ...req.body,
        };
        const result = await hopkidReportService.executeReport(reportKey, payload);
        return res.json(result);
      } catch (error) {
        return handleError(res, error, `Failed to execute report: ${reportKey}`);
      }
    };
  }

  /**
   * Generic execution endpoint for parameterized report execution
   */
  public static async executeReportBySlug(req: Request, res: Response) {
    try {
      const { category, slug } = req.params;
      const reportKey = `${category}/${slug}`;
      const payload = {
        ...req.query,
        ...req.body,
      };
      const result = await hopkidReportService.executeReport(reportKey, payload);
      return res.json(result);
    } catch (error) {
      return handleError(res, error, 'Failed to execute report');
    }
  }
}

