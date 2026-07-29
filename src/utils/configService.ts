import { prisma } from './db';

export interface IntegrationSettings {
  hopkidApiUrl: string;
  hopkidApiKey: string;
  mobileApiKey: string;
  firebaseServerKey: string;
}

const DEFAULT_SETTINGS: IntegrationSettings = {
  hopkidApiUrl: process.env.HOPKID_API_URL || 'https://hopkidapi.3dweb.in/api/Employee/GetEmployeeList',
  hopkidApiKey: process.env.HOPKID_API_KEY || 'HOPKID-MOBILE-ACCESS-API-KEY',
  mobileApiKey: process.env.MOBILE_API_KEY || 'HOPKID-MOBILE-ACCESS-API-KEY',
  firebaseServerKey: process.env.FIREBASE_SERVER_KEY || '',
};

let cachedSettings: IntegrationSettings | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5000; // 5 seconds cache in memory

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  const now = Date.now();
  if (cachedSettings && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const systemSetting = await prisma.systemSetting.findUnique({
      where: { id: 1 },
    });

    const rawIntegrations = (systemSetting?.integrations as any) || {};

    cachedSettings = {
      hopkidApiUrl: rawIntegrations.hopkidApiUrl?.trim() || DEFAULT_SETTINGS.hopkidApiUrl,
      hopkidApiKey: rawIntegrations.hopkidApiKey?.trim() || DEFAULT_SETTINGS.hopkidApiKey,
      mobileApiKey: rawIntegrations.mobileApiKey?.trim() || DEFAULT_SETTINGS.mobileApiKey,
      firebaseServerKey: rawIntegrations.firebaseServerKey?.trim() || DEFAULT_SETTINGS.firebaseServerKey,
    };

    lastFetchTime = now;
    return cachedSettings;
  } catch (error) {
    console.error('⚠️ [configService] Error fetching integration settings from DB, using fallback defaults:', error);
    return DEFAULT_SETTINGS;
  }
}

export function clearIntegrationCache(): void {
  cachedSettings = null;
  lastFetchTime = 0;
  console.log('🔄 [configService] Integration settings cache invalidated.');
}
