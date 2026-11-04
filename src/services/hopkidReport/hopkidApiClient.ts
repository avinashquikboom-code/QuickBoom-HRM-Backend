/**
 * HopKid Report API Client
 * Centralized, secure, read-only HTTP client for HopKid Report & Filter endpoints.
 * Base URL: https://hopkidapi.3dweb.in/api/
 */

export class HopKidReportError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly upstreamMessage?: string;

  constructor(message: string, statusCode = 500, errorCode = 'ERR_HOPKID_REPORT', upstreamMessage?: string) {
    super(message);
    this.name = 'HopKidReportError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.upstreamMessage = upstreamMessage;
  }
}

export interface HopKidEnvelope<T = any> {
  success: boolean;
  message?: string;
  data: T;
  statusCode?: number;
  statusValueCode?: number;
}

const DEFAULT_BASE_URL = 'https://hopkidapi.3dweb.in/api/';
const DEFAULT_TIMEOUT_MS = 45000;

export class HopKidApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Retrieves the API key from environment variables.
   * Priority: HOPKID_REPORT_API_KEY, fallback to HOPKID_API_KEY.
   */
  public getApiKey(): string {
    const key = (process.env.HOPKID_REPORT_API_KEY || process.env.HOPKID_API_KEY || '').trim();
    return key;
  }

  /**
   * Builds the full URL ensuring no duplicate or missing slashes.
   */
  private buildUrl(endpoint: string, queryParams?: Record<string, string | number | boolean | undefined | null>): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = new URL(cleanEndpoint, this.baseUrl);

    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    return url.toString();
  }

  /**
   * Mask sensitive keys in logs
   */
  private maskKey(key: string): string {
    if (!key) return '(not configured)';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  /**
   * Performs an authenticated GET request.
   */
  public async get<T = any>(
    endpoint: string,
    queryParams?: Record<string, string | number | boolean | undefined | null>
  ): Promise<HopKidEnvelope<T>> {
    return this.request<T>('GET', endpoint, { queryParams });
  }

  /**
   * Performs an authenticated POST request.
   */
  public async post<T = any>(
    endpoint: string,
    body?: any,
    queryParams?: Record<string, string | number | boolean | undefined | null>
  ): Promise<HopKidEnvelope<T>> {
    return this.request<T>('POST', endpoint, { body, queryParams });
  }

  /**
   * Core request dispatcher with validation, error translation, and logging.
   */
  private async request<T = any>(
    method: 'GET' | 'POST',
    endpoint: string,
    options: {
      body?: any;
      queryParams?: Record<string, string | number | boolean | undefined | null>;
    } = {}
  ): Promise<HopKidEnvelope<T>> {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      console.warn('[HopKidApiClient] Missing HOPKID_REPORT_API_KEY in environment');
      throw new HopKidReportError(
        'HopKid Report API Key is missing. Please configure HOPKID_REPORT_API_KEY in the backend environment.',
        500,
        'ERR_MISSING_API_KEY'
      );
    }

    const fullUrl = this.buildUrl(endpoint, options.queryParams);
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'X-Api-Key': apiKey,
    };

    let serializedBody: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      serializedBody = options.body !== undefined ? JSON.stringify(options.body) : '{}';
    }

    const startTime = Date.now();
    try {
      console.info(
        `[HopKidApiClient] -> ${method} ${fullUrl} [Key: ${this.maskKey(apiKey)}]`
      );

      const response = await fetch(fullUrl, {
        method,
        headers,
        body: serializedBody,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;
      console.info(`[HopKidApiClient] <- ${method} ${fullUrl} HTTP ${response.status} (${durationMs}ms)`);

      if (response.status === 401) {
        throw new HopKidReportError(
          'HopKid API rejected credentials (401 Unauthorized). Verify that HOPKID_REPORT_API_KEY is valid and authorized for reports.',
          401,
          'ERR_UNAUTHORIZED'
        );
      }

      if (response.status === 404) {
        throw new HopKidReportError(
          `HopKid endpoint not found (404 Not Found): ${endpoint}`,
          404,
          'ERR_NOT_FOUND'
        );
      }

      if (!response.ok) {
        let errBodyText = '';
        try {
          errBodyText = await response.text();
        } catch {
          // ignore
        }
        throw new HopKidReportError(
          `HopKid service returned HTTP error ${response.status}: ${response.statusText || 'Unknown'}`,
          response.status >= 500 ? 502 : response.status,
          'ERR_UPSTREAM_HTTP',
          errBodyText
        );
      }

      let json: any;
      try {
        json = await response.json();
      } catch (err: any) {
        throw new HopKidReportError(
          `Failed to parse HopKid JSON response: ${err?.message || 'Invalid JSON format'}`,
          502,
          'ERR_INVALID_JSON'
        );
      }

      // Check the envelope
      if (typeof json === 'object' && json !== null) {
        if (json.success === false) {
          const msg = json.message || 'HopKid reported an unsuccessful request.';
          if (/unauthorized/i.test(msg)) {
            throw new HopKidReportError(
              `HopKid API authentication failed: ${msg}`,
              401,
              'ERR_UNAUTHORIZED',
              msg
            );
          }
          throw new HopKidReportError(
            `HopKid reported failure: ${msg}`,
            400,
            'ERR_UPSTREAM_FAILURE',
            msg
          );
        }
        return json as HopKidEnvelope<T>;
      }

      // Fallback if returned raw array or object
      return {
        success: true,
        message: '',
        data: json as T,
      };
    } catch (error: any) {
      if (error instanceof HopKidReportError) {
        throw error;
      }

      if (error?.name === 'AbortError' || controller.signal.aborted) {
        console.error(`[HopKidApiClient] Request timeout for ${endpoint} after ${this.timeoutMs}ms`);
        throw new HopKidReportError(
          `HopKid API request timed out after ${this.timeoutMs / 1000} seconds. Please narrow your date range or filter criteria.`,
          504,
          'ERR_TIMEOUT'
        );
      }

      console.error(`[HopKidApiClient] Network or fetch error for ${endpoint}:`, error?.message || error);
      throw new HopKidReportError(
        `Failed to communicate with HopKid API: ${error?.message || 'Network connection failed'}`,
        502,
        'ERR_NETWORK'
      );
    } finally {
      clearTimeout(timeoutTimer);
    }
  }
}

export const hopkidApiClient = new HopKidApiClient();

