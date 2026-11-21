/**
 * HopKid Filter List and ID Mapping Service
 * Handles fetching, caching, and UUID <-> Integer resolution for HopKid filter lists.
 */

import { hopkidApiClient } from './hopkidApiClient';
import { prisma } from '../../utils/db';

export interface HopKidFilterItem {
  id: string; // The original HopKid UUID (preserved intact)
  name: string; // Human-readable label
  uuid: string; // Explicit HopKid UUID string
  internalId?: number | null; // Internal PostgreSQL Int ID if mapped
  code?: string | null;
}

export type FilterType = 'branch' | 'brand' | 'category' | 'subcategory' | 'department' | 'supplier';

interface FilterCacheEntry {
  data: HopKidFilterItem[];
  cachedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HopKidFilterService {
  private cache: Map<FilterType, FilterCacheEntry> = new Map();
  // Bidirectional in-memory lookup maps:
  // filterType -> (internalId -> uuid)
  private internalToUuidMap: Map<FilterType, Map<number, string>> = new Map();
  // filterType -> (uuid -> internalId)
  private uuidToInternalMap: Map<FilterType, Map<string, number>> = new Map();

  constructor() {
    for (const type of ['branch', 'brand', 'category', 'subcategory', 'department', 'supplier'] as FilterType[]) {
      this.internalToUuidMap.set(type, new Map());
      this.uuidToInternalMap.set(type, new Map());
    }
  }

  /**
   * Checks if an ID string matches standard UUID format.
   */
  public isUuid(val: any): boolean {
    if (typeof val !== 'string') return false;
    return UUID_REGEX.test(val.trim());
  }

  /**
   * Invalidate and clear all filter caches.
   */
  public clearCache(): void {
    this.cache.clear();
    console.info('[HopKidFilterService] Filter cache cleared.');
  }

  /**
   * Refreshes all 6 filter lists from HopKid.
   */
  public async refreshAll(): Promise<{
    branches: number;
    brands: number;
    categories: number;
    subcategories: number;
    departments: number;
    suppliers: number;
  }> {
    this.clearCache();
    const [branches, brands, categories, subcategories, departments, suppliers] = await Promise.all([
      this.getBranches(true),
      this.getBrands(true),
      this.getCategories(true),
      this.getSubCategories(true),
      this.getDepartments(true),
      this.getSuppliers(true),
    ]);

    return {
      branches: branches.length,
      brands: brands.length,
      categories: categories.length,
      subcategories: subcategories.length,
      departments: departments.length,
      suppliers: suppliers.length,
    };
  }

  /**
   * 1. Branches: GET Branch/GetBranchSelectList
   */
  public async getBranches(forceRefresh = false): Promise<HopKidFilterItem[]> {
    return this.getOrFetchFilter('branch', forceRefresh, async () => {
      const res = await hopkidApiClient.get<Array<{ branchID: string; branchName: string }>>(
        'Branch/GetBranchSelectList'
      );
      const rawItems = this.requireArray(res.data, 'Branch/GetBranchSelectList');

      // Attempt to map with internal DB Branch / Store records
      let internalBranches: Array<{ id: number; name: string }> = [];
      let internalStores: Array<{ id: number; name: string; code: string | null }> = [];
      try {
        [internalBranches, internalStores] = await Promise.all([
          prisma.branch.findMany({ select: { id: true, name: true } }).catch(() => []),
          prisma.store.findMany({ select: { id: true, name: true, code: true } }).catch(() => []),
        ]);
      } catch (e) {
        console.warn('[HopKidFilterService] Could not query internal branches/stores for mapping:', e);
      }

      return rawItems.flatMap((item) => {
        const uuid = this.requireUuid(item?.branchID, 'branchID');
        const name = this.requireString(item?.branchName, 'branchName');

        // Match against internal branch/store
        const matchedBranch = internalBranches.find(
          b => b.name.trim().toLowerCase() === name.toLowerCase()
        );
        const matchedStore = internalStores.find(
          s => s.name.trim().toLowerCase() === name.toLowerCase()
        );

        const internalId = matchedBranch?.id ?? matchedStore?.id ?? null;

        return [{
          id: uuid,
          uuid,
          name,
          internalId,
        }];
      });
    });
  }

  /**
   * 2. Brands: GET Brand/GetBrandSelectList
   */
  public async getBrands(forceRefresh = false): Promise<HopKidFilterItem[]> {
    return this.getOrFetchFilter('brand', forceRefresh, async () => {
      const res = await hopkidApiClient.get<Array<{ brandID: string; brandName: string }>>(
        'Brand/GetBrandSelectList'
      );
      const rawItems = this.requireArray(res.data, 'Brand/GetBrandSelectList');
      return rawItems.flatMap((item) => {
        const uuid = this.requireUuid(item?.brandID, 'brandID');
        const name = this.requireString(item?.brandName, 'brandName');
        return [{
          id: uuid,
          uuid,
          name,
        }];
      });
    });
  }

  /**
   * 3. Categories: GET Category/GetCategorySelectList
   */
  public async getCategories(forceRefresh = false): Promise<HopKidFilterItem[]> {
    return this.getOrFetchFilter('category', forceRefresh, async () => {
      const res = await hopkidApiClient.get<Array<{ categoryID: string; categoryName: string }>>(
        'Category/GetCategorySelectList'
      );
      const rawItems = this.requireArray(res.data, 'Category/GetCategorySelectList');
      return rawItems.flatMap((item) => {
        const uuid = this.requireUuid(item?.categoryID, 'categoryID');
        const name = this.requireString(item?.categoryName, 'categoryName');
        return [{
          id: uuid,
          uuid,
          name,
        }];
      });
    });
  }

  /**
   * 4. SubCategories: GET SubCategory/GetSubCategorySelectList
   */
  public async getSubCategories(forceRefresh = false): Promise<HopKidFilterItem[]> {
    return this.getOrFetchFilter('subcategory', forceRefresh, async () => {
      const res = await hopkidApiClient.get<Array<{ subCategoryID: string; subCategoryName: string }>>(
        'SubCategory/GetSubCategorySelectList'
      );
      const rawItems = this.requireArray(res.data, 'SubCategory/GetSubCategorySelectList');
      return rawItems.flatMap((item) => {
        const uuid = this.requireUuid(item?.subCategoryID, 'subCategoryID');
        const name = this.requireString(item?.subCategoryName, 'subCategoryName');
        return [{
          id: uuid,
          uuid,
          name,
        }];
      });
    });
  }

  /**
   * 5. Departments: GET Department/GetDepartmentSelectList
   */
  public async getDepartments(forceRefresh = false): Promise<HopKidFilterItem[]> {
    return this.getOrFetchFilter('department', forceRefresh, async () => {
      const res = await hopkidApiClient.get<Array<{ departmentID: string; departmentName: string }>>(
        'Department/GetDepartmentSelectList'
      );
      const rawItems = this.requireArray(res.data, 'Department/GetDepartmentSelectList');

      let internalDepts: Array<{ id: number; name: string }> = [];
      try {
        internalDepts = await prisma.department.findMany({ select: { id: true, name: true } }).catch(() => []);
      } catch (e) {
        console.warn('[HopKidFilterService] Could not query internal departments for mapping:', e);
      }

      return rawItems.flatMap((item) => {
        const uuid = this.requireUuid(item?.departmentID, 'departmentID');
        const name = this.requireString(item?.departmentName, 'departmentName');
        const matched = internalDepts.find(d => d.name.trim().toLowerCase() === name.toLowerCase());

        return [{
          id: uuid,
          uuid,
          name,
          internalId: matched?.id ?? null,
        }];
      });
    });
  }

  /**
   * 6. Suppliers: GET Supply/GetSupplyDropdown
   */
  public async getSuppliers(forceRefresh = false): Promise<HopKidFilterItem[]> {
    return this.getOrFetchFilter('supplier', forceRefresh, async () => {
      const res = await hopkidApiClient.get<Array<{ supplyID: string; supplierName: string }>>(
        'Supply/GetSupplyDropdown'
      );
      const rawItems = this.requireArray(res.data, 'Supply/GetSupplyDropdown');
      return rawItems.flatMap((item) => {
        const uuid = this.requireUuid(item?.supplyID, 'supplyID');
        const name = this.requireString(item?.supplierName, 'supplierName');
        return [{
          id: uuid,
          uuid,
          name,
        }];
      });
    });
  }

  /**
   * Resolve an array of inputs (which may contain HopKid UUID strings, integer IDs, or stringified integers)
   * into a verified list of HopKid UUID strings.
   * NEVER returns integer IDs. Original UUIDs are never mutated or truncated.
   */
  public async resolveToHopkidUuids(
    values: Array<string | number> | string | number | undefined | null,
    type: FilterType
  ): Promise<string[]> {
    if (!values) return [];

    const rawList = Array.isArray(values) ? values : [values];
    if (rawList.length === 0) return [];

    // Fast-path: Check if all values are already valid UUIDs
    const allValidUuids = rawList.every(v => typeof v === 'string' && this.isUuid(v));
    if (allValidUuids) {
      return Array.from(new Set(rawList.map(v => String(v).trim())));
    }

    // Otherwise, ensure cache is loaded so integer mappings exist
    try {
      await this.ensureFilterLoaded(type);
    } catch (e) {
      console.warn(`[HopKidFilterService] Could not preload ${type} filter for mapping resolution:`, e);
    }

    const intMap = this.internalToUuidMap.get(type);
    const resolvedUuids: string[] = [];

    for (const val of rawList) {
      if (val === undefined || val === null || val === '') continue;

      // 1. If it's already a valid UUID string, preserve verbatim!
      if (typeof val === 'string' && this.isUuid(val)) {
        resolvedUuids.push(val.trim());
        continue;
      }

      // 2. If it's an integer or stringified integer
      const numericVal = typeof val === 'number' ? val : parseInt(String(val).trim(), 10);
      if (!isNaN(numericVal) && intMap && intMap.has(numericVal)) {
        const mappedUuid = intMap.get(numericVal)!;
        resolvedUuids.push(mappedUuid);
        continue;
      }

      // 3. Fallback: Check if string matches any item's name or code
      if (typeof val === 'string') {
        const cached = this.cache.get(type)?.data || [];
        const match = cached.find(
          c => c.name.toLowerCase() === val.toLowerCase().trim() || c.uuid.toLowerCase() === val.toLowerCase().trim()
        );
        if (match) {
          resolvedUuids.push(match.uuid);
          continue;
        }
      }

      console.warn(`[HopKidFilterService] Could not resolve filter identifier '${val}' to a HopKid UUID for ${type}.`);
    }

    // Deduplicate while preserving order
    return Array.from(new Set(resolvedUuids));
  }

  /**
   * Helper to ensure a filter type is loaded in cache
   */
  private async ensureFilterLoaded(type: FilterType): Promise<void> {
    switch (type) {
      case 'branch':
        await this.getBranches();
        break;
      case 'brand':
        await this.getBrands();
        break;
      case 'category':
        await this.getCategories();
        break;
      case 'subcategory':
        await this.getSubCategories();
        break;
      case 'department':
        await this.getDepartments();
        break;
      case 'supplier':
        await this.getSuppliers();
        break;
    }
  }

  /**
   * Cache wrapper
   */
  private async getOrFetchFilter(
    type: FilterType,
    forceRefresh: boolean,
    fetcher: () => Promise<HopKidFilterItem[]>
  ): Promise<HopKidFilterItem[]> {
    const now = Date.now();
    const entry = this.cache.get(type);

    if (!forceRefresh && entry && now - entry.cachedAt < CACHE_TTL_MS) {
      return entry.data;
    }

    try {
      const items = await fetcher();
      this.cache.set(type, { data: items, cachedAt: now });

      // Update mapping lookups
      const intMap = this.internalToUuidMap.get(type)!;
      const uuidMap = this.uuidToInternalMap.get(type)!;
      intMap.clear();
      uuidMap.clear();

      for (const item of items) {
        if (item.internalId !== undefined && item.internalId !== null) {
          intMap.set(item.internalId, item.uuid);
          uuidMap.set(item.uuid, item.internalId);
        }
      }

      return items;
    } catch (error) {
      console.error('[HopKidFilterService] Filter fetch failed', {
        type,
        cachedDataAvailable: Boolean(entry),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  private requireArray(value: unknown, endpoint: string): any[] {
    if (value === null) return [];
    if (!Array.isArray(value)) throw new Error(`HopKid ${endpoint} returned data in an unexpected format.`);
    return value;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`HopKid filter item is missing a valid ${field}.`);
    return value.trim();
  }

  private requireUuid(value: unknown, field: string): string {
    const uuid = this.requireString(value, field);
    if (!UUID_REGEX.test(uuid)) throw new Error(`HopKid filter item has an invalid UUID in ${field}.`);
    return uuid;
  }
}

export const hopkidFilterService = new HopKidFilterService();
