/**
 * HopKid Report Execution Service
 * Manages all 25 HopKid report endpoints, payload building, filter mapping,
 * pagination normalization, and error isolation.
 */

import { hopkidApiClient, HopKidReportError } from './hopkidApiClient';
import { hopkidFilterService } from './hopkidFilterService';

export type ReportCategory = 'sales' | 'purchase' | 'stock' | 'stock-transfer' | 'vasy';

export interface ReportDefinition {
  key: string; // Internal route slug (e.g. 'sales/item-register')
  title: string;
  category: ReportCategory;
  endpoint: string; // HopKid API path relative to base URL
  method: 'GET' | 'POST';
  payloadType: 'standard' | 'special_json_branches' | 'query_params';
  supportedFilters: {
    dateRange?: boolean;
    branch?: boolean;
    toBranch?: boolean;
    brand?: boolean;
    category?: boolean;
    subcategory?: boolean;
    department?: boolean;
    supplier?: boolean;
    search?: boolean;
    pagination?: boolean;
    export?: boolean;
  };
  description?: string;
}

export interface ReportRequestPayload {
  fromDate?: string;
  toDate?: string;
  branchIDs?: Array<string | number>;
  toBranchIDs?: Array<string | number>;
  brandIDs?: Array<string | number>;
  categoryIDs?: Array<string | number>;
  subCategoryIDs?: Array<string | number>;
  departmentIDs?: Array<string | number>;
  supplierID?: string | number;
  branchId?: string | number; // For GET reports
  supplierId?: string | number; // For GET reports
  searchTerm?: string;
  pageNumber?: number;
  pageSize?: number;
  isExport?: boolean;
}

export interface HopKidReportResult<T = any> {
  success: boolean;
  message: string;
  data: {
    items: T[];
    totalCount: number;
    pageNumber: number;
    pageSize: number;
    totals?: Record<string, any> | null;
  };
  isExport?: boolean;
}

// Registry of all 25 reports
export const REPORT_DEFINITIONS: Record<string, ReportDefinition> = {
  // ─── 5.1 Sales Reports (7) ──────────────────────────────────────────────────────────
  'sales/item-register': {
    key: 'sales/item-register',
    title: 'Sales & Item Register',
    category: 'sales',
    endpoint: 'Reports/SalesandItemReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Detailed item-level sales register with invoices, items, and tax breakdowns.',
  },
  'sales/brand-wise': {
    key: 'sales/brand-wise',
    title: 'Sales & Item Register - Brand Wise',
    category: 'sales',
    endpoint: 'Reports/BrandWiseSalesandItemReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, brand: true, search: true, pagination: true, export: true },
    description: 'Item sales register filtered by brand and branch.',
  },
  'sales/returns': {
    key: 'sales/returns',
    title: 'Sales & Return Item Register',
    category: 'sales',
    endpoint: 'Reports/SalesandItemReturnReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Register of sales returns and credit note items.',
  },
  'sales/brand-wise-returns': {
    key: 'sales/brand-wise-returns',
    title: 'Sales & Return Item Register - Brand Wise',
    category: 'sales',
    endpoint: 'Reports/BrandWiseSalesandItemReturnReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, brand: true, search: true, pagination: true, export: true },
    description: 'Sales return item register filtered by brand.',
  },
  'sales/daily-summary': {
    key: 'sales/daily-summary',
    title: 'Daily Sales Summary',
    category: 'sales',
    endpoint: 'Reports/GetDailySalesSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, search: true, pagination: true, export: true },
    description: 'Day-by-day sales summary totals.',
  },
  'sales/brand-summary': {
    key: 'sales/brand-summary',
    title: 'Sales Summary - Brand Wise',
    category: 'sales',
    endpoint: 'Reports/GetBrandWiseSalesSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, brand: true, search: true, pagination: true, export: true },
    description: 'Aggregated sales summary grouped by brand.',
  },
  'sales/employee-summary': {
    key: 'sales/employee-summary',
    title: 'Employee Sales Summary',
    category: 'sales',
    endpoint: 'Reports/GetEmployeeSalesSummary',
    method: 'GET',
    payloadType: 'query_params',
    supportedFilters: { dateRange: true, branch: true },
    description: 'Sales summary grouped by employee.',
  },

  // ─── 5.2 Purchase Reports (6) ───────────────────────────────────────────────────────
  'purchase/register': {
    key: 'purchase/register',
    title: 'Purchase Register (GST)',
    category: 'purchase',
    endpoint: 'PurchaseRegister/GetReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Purchase invoices with supplier, invoice no, taxable value, IGST, CGST, and SGST.',
  },
  'purchase/summary': {
    key: 'purchase/summary',
    title: 'Purchase Summary',
    category: 'purchase',
    endpoint: 'Reports/GetPurchaseSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Aggregated purchase summary.',
  },
  'purchase/summary-detailed': {
    key: 'purchase/summary-detailed',
    title: 'Purchase Summary - Detailed',
    category: 'purchase',
    endpoint: 'Reports/GetPurchaseSummaryDetail',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Detailed purchase register with item breakdowns.',
  },
  'purchase/return-summary': {
    key: 'purchase/return-summary',
    title: 'Purchase Return Summary',
    category: 'purchase',
    endpoint: 'Reports/GetPurchaseReturnSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Aggregated summary of purchase returns.',
  },
  'purchase/return-summary-detailed': {
    key: 'purchase/return-summary-detailed',
    title: 'Purchase Return Summary - Detailed',
    category: 'purchase',
    endpoint: 'Reports/GetPurchaseReturnSummaryDetail',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Detailed line-item records for purchase returns.',
  },
  'purchase/simple-summary': {
    key: 'purchase/simple-summary',
    title: 'Purchase Summary (Simple)',
    category: 'purchase',
    endpoint: 'Reports/GetPurchaseSummary',
    method: 'GET',
    payloadType: 'query_params',
    supportedFilters: { dateRange: true, branch: true, supplier: true },
    description: 'Simple purchase summary with branch and supplier filters.',
  },

  // ─── 5.3 Stock Reports (8) ──────────────────────────────────────────────────────────
  'stock/barcode-wise': {
    key: 'stock/barcode-wise',
    title: 'Stock Report (Barcode Wise, All Branches)',
    category: 'stock',
    endpoint: 'Reports/GetStockReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: {
      dateRange: true,
      department: true,
      brand: true,
      category: true,
      subcategory: true,
      search: true,
      pagination: true,
      export: true,
    },
    description: 'Barcode-wise stock inventory across all branches.',
  },
  'stock/branch-wise': {
    key: 'stock/branch-wise',
    title: 'Stock Report - Branch Wise',
    category: 'stock',
    endpoint: 'Reports/GetBranchStockReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: {
      dateRange: true,
      branch: true,
      department: true,
      brand: true,
      category: true,
      subcategory: true,
      search: true,
      pagination: true,
      export: true,
    },
    description: 'Branch-filtered stock inventory report.',
  },
  'stock/summary': {
    key: 'stock/summary',
    title: 'Stock Summary',
    category: 'stock',
    endpoint: 'Reports/StockSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'High-level stock summary by branch.',
  },
  'stock/summary-detailed': {
    key: 'stock/summary-detailed',
    title: 'Stock Summary - Detailed',
    category: 'stock',
    endpoint: 'Reports/StockSummaryDetailedReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Detailed stock summary with quantity and valuation.',
  },
  'stock/auto-replenishment': {
    key: 'stock/auto-replenishment',
    title: 'Auto Replenishment Summary',
    category: 'stock',
    endpoint: 'Reports/GetAutoReplenishmentSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, search: true, pagination: true, export: true },
    description: 'Stock levels vs reorder thresholds for auto replenishment.',
  },
  'stock/design-summary': {
    key: 'stock/design-summary',
    title: 'Design Summary (Purchased / Sold / Returned / In Stock)',
    category: 'stock',
    endpoint: 'DesignSummaryReport/GetReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: {
      dateRange: true,
      department: true,
      brand: true,
      category: true,
      subcategory: true,
      search: true,
      pagination: true,
      export: true,
    },
    description: 'Complete lifecycle summary per design number.',
  },
  'stock/inventory-detailed': {
    key: 'stock/inventory-detailed',
    title: 'Inventory Summary - Detailed',
    category: 'stock',
    endpoint: 'Reports/InventorySummaryDetailedReport',
    method: 'POST',
    payloadType: 'special_json_branches',
    supportedFilters: { branch: true },
    description: 'Current real-time stock snapshot. Uses JSON-encoded branch list.',
  },
  'stock/inter-branch': {
    key: 'stock/inter-branch',
    title: 'Inter Branch Stock',
    category: 'stock',
    endpoint: 'Reports/InterBranchStockReport',
    method: 'POST',
    payloadType: 'special_json_branches',
    supportedFilters: { branch: true },
    description: 'Stock comparison across branches for stock balancing.',
  },

  // ─── 5.4 Stock Transfer Reports (2) ─────────────────────────────────────────────────
  'stock-transfer/summary': {
    key: 'stock-transfer/summary',
    title: 'Stock Transfer Summary',
    category: 'stock-transfer',
    endpoint: 'Reports/GetStockTransferSummaryReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, toBranch: true, search: true, pagination: true, export: true },
    description: 'Summary of stock movements between sending and receiving branches.',
  },
  'stock-transfer/summary-detailed': {
    key: 'stock-transfer/summary-detailed',
    title: 'Stock Transfer Summary - Detailed',
    category: 'stock-transfer',
    endpoint: 'Reports/GetStockTransferSummaryDetail',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, branch: true, toBranch: true, search: true, pagination: true, export: true },
    description: 'Item-level detailed stock transfer register.',
  },

  // ─── 5.5 Vasy Reports (2) ───────────────────────────────────────────────────────────
  'vasy/sales': {
    key: 'vasy/sales',
    title: 'Vasy Sales',
    category: 'vasy',
    endpoint: 'Reports/VasySalesReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, search: true, pagination: true, export: true },
    description: 'Historical sales data migrated from old Vasy system.',
  },
  'vasy/purchase': {
    key: 'vasy/purchase',
    title: 'Vasy Purchase',
    category: 'vasy',
    endpoint: 'Reports/VasyPurchaseReport',
    method: 'POST',
    payloadType: 'standard',
    supportedFilters: { dateRange: true, search: true, pagination: true, export: true },
    description: 'Historical purchase data migrated from old Vasy system.',
  },
};

export class HopKidReportService {
  /**
   * Returns metadata for all supported reports or filtered by category.
   */
  public getReportList(category?: ReportCategory): ReportDefinition[] {
    const list = Object.values(REPORT_DEFINITIONS);
    if (!category) return list;
    return list.filter(r => r.category === category);
  }

  /**
   * Retrieves definition for a report key.
   */
  public getDefinition(reportKey: string): ReportDefinition {
    const def = REPORT_DEFINITIONS[reportKey];
    if (!def) {
      throw new HopKidReportError(`Unknown report identifier: '${reportKey}'`, 404, 'ERR_REPORT_NOT_FOUND');
    }
    return def;
  }

  /**
   * Executes any documented report by its identifier with full validation.
   */
  public async executeReport(
    reportKey: string,
    rawPayload: ReportRequestPayload = {}
  ): Promise<HopKidReportResult> {
    const def = this.getDefinition(reportKey);

    if (def.method === 'GET') {
      return this.executeGetReport(def, rawPayload);
    }

    if (def.payloadType === 'special_json_branches') {
      return this.executeSpecialBranchReport(def, rawPayload);
    }

    return this.executeStandardPostReport(def, rawPayload);
  }

  /**
   * Helper to format a date to 'yyyy-MM-dd'
   */
  private formatDate(dateVal?: string): string {
    if (!dateVal || typeof dateVal !== 'string') {
      const now = new Date();
      return now.toISOString().split('T')[0];
    }
    const clean = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      return clean;
    }
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return clean;
  }

  /**
   * Executes standard POST report
   */
  private async executeStandardPostReport(
    def: ReportDefinition,
    rawPayload: ReportRequestPayload
  ): Promise<HopKidReportResult> {
    const body: Record<string, any> = {};

    // 1. Dates
    if (def.supportedFilters.dateRange) {
      body.fromDate = this.formatDate(rawPayload.fromDate);
      body.toDate = this.formatDate(rawPayload.toDate);
    }

    // 2. Branch IDs (resolve UUIDs)
    if (def.supportedFilters.branch) {
      body.branchIDs = await hopkidFilterService.resolveToHopkidUuids(rawPayload.branchIDs, 'branch');
    }

    // 3. ToBranch IDs (Stock Transfer)
    if (def.supportedFilters.toBranch) {
      body.toBranchIDs = await hopkidFilterService.resolveToHopkidUuids(rawPayload.toBranchIDs, 'branch');
    }

    // 4. Brand IDs
    if (def.supportedFilters.brand) {
      body.brandIDs = await hopkidFilterService.resolveToHopkidUuids(rawPayload.brandIDs, 'brand');
    }

    // 5. Category IDs
    if (def.supportedFilters.category) {
      body.categoryIDs = await hopkidFilterService.resolveToHopkidUuids(rawPayload.categoryIDs, 'category');
    }

    // 6. SubCategory IDs
    if (def.supportedFilters.subcategory) {
      body.subCategoryIDs = await hopkidFilterService.resolveToHopkidUuids(rawPayload.subCategoryIDs, 'subcategory');
    }

    // 7. Department IDs
    if (def.supportedFilters.department) {
      body.departmentIDs = await hopkidFilterService.resolveToHopkidUuids(rawPayload.departmentIDs, 'department');
    }

    // 8. Search Term
    if (def.supportedFilters.search) {
      body.searchTerm = typeof rawPayload.searchTerm === 'string' ? rawPayload.searchTerm.trim() : '';
    }

    // 9. Pagination
    const isExport = Boolean(rawPayload.isExport);
    body.isExport = isExport;

    if (!isExport) {
      body.pageNumber = Math.max(1, Number(rawPayload.pageNumber) || 1);
      const reqPageSize = Number(rawPayload.pageSize) || 100;
      // Keep pageSize reasonable (100-500 recommended)
      body.pageSize = Math.min(Math.max(10, reqPageSize), 500);
    } else {
      body.pageNumber = 1;
      body.pageSize = 10000;
    }

    const response = await hopkidApiClient.post(def.endpoint, body);
    return this.normalizeResponse(response, isExport, body.pageNumber, body.pageSize);
  }

  /**
   * Executes special JSON string branch payload:
   * Used by Reports/InventorySummaryDetailedReport and Reports/InterBranchStockReport
   * Example payload: { "branchIDs": "[\"5f0bcdec-...\",\"db85cf3e-...\"]" }
   * or {} for all branches.
   */
  private async executeSpecialBranchReport(
    def: ReportDefinition,
    rawPayload: ReportRequestPayload
  ): Promise<HopKidReportResult> {
    const resolvedUuids = await hopkidFilterService.resolveToHopkidUuids(rawPayload.branchIDs, 'branch');

    let body: Record<string, any> = {};
    if (resolvedUuids.length > 0) {
      // Must be a stringified JSON array of UUIDs
      body = {
        branchIDs: JSON.stringify(resolvedUuids),
      };
    } else {
      // Empty object for all branches as per documentation
      body = {};
    }

    const response = await hopkidApiClient.post(def.endpoint, body);
    return this.normalizeResponse(response, false, 1, 500);
  }

  /**
   * Executes GET report with URL parameters
   * EmployeeSalesSummary: fromDate, toDate, branchId (optional)
   * PurchaseSummary: fromDate, toDate, branchId (optional), supplierId (optional)
   */
  private async executeGetReport(
    def: ReportDefinition,
    rawPayload: ReportRequestPayload
  ): Promise<HopKidReportResult> {
    const queryParams: Record<string, string> = {
      fromDate: this.formatDate(rawPayload.fromDate),
      toDate: this.formatDate(rawPayload.toDate),
    };

    // Single branchId if provided
    const rawBranch = rawPayload.branchId || (rawPayload.branchIDs && rawPayload.branchIDs[0]);
    if (rawBranch) {
      const resolved = await hopkidFilterService.resolveToHopkidUuids([rawBranch], 'branch');
      if (resolved.length > 0) {
        queryParams.branchId = resolved[0];
      }
    }

    // Single supplierId if provided
    const rawSupplier = rawPayload.supplierId || rawPayload.supplierID;
    if (rawSupplier) {
      const resolved = await hopkidFilterService.resolveToHopkidUuids([rawSupplier], 'supplier');
      if (resolved.length > 0) {
        queryParams.supplierId = resolved[0];
      }
    }

    const response = await hopkidApiClient.get(def.endpoint, queryParams);
    return this.normalizeResponse(response, false, 1, 100);
  }

  /**
   * Normalizes paginated or raw array responses into a consistent structure.
   */
  private normalizeResponse(
    response: any,
    isExport: boolean,
    fallbackPageNumber = 1,
    fallbackPageSize = 100
  ): HopKidReportResult {
    const rawData = response?.data;

    // Case 1: Standard paginated object { items: [], totalCount: 2237, pageNumber: 1, pageSize: 100, totals: {} }
    if (rawData && typeof rawData === 'object' && !Array.isArray(rawData) && Array.isArray(rawData.items)) {
      return {
        success: true,
        message: response?.message || '',
        data: {
          items: rawData.items,
          totalCount: typeof rawData.totalCount === 'number' ? rawData.totalCount : rawData.items.length,
          pageNumber: typeof rawData.pageNumber === 'number' ? rawData.pageNumber : fallbackPageNumber,
          pageSize: typeof rawData.pageSize === 'number' ? rawData.pageSize : fallbackPageSize,
          totals: rawData.totals || null,
        },
        isExport,
      };
    }

    // Case 2: Plain array returned (e.g. isExport: true, GET endpoints, or special stock reports)
    if (Array.isArray(rawData)) {
      return {
        success: true,
        message: response?.message || '',
        data: {
          items: rawData,
          totalCount: rawData.length,
          pageNumber: 1,
          pageSize: rawData.length,
          totals: null,
        },
        isExport,
      };
    }

    // Case 3: Empty or null data
    return {
      success: true,
      message: response?.message || 'No records found.',
      data: {
        items: [],
        totalCount: 0,
        pageNumber: fallbackPageNumber,
        pageSize: fallbackPageSize,
        totals: null,
      },
      isExport,
    };
  }
}

export const hopkidReportService = new HopKidReportService();

