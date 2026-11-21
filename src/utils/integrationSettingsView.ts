const SECRET_FIELDS = [
  'hopkidApiKey',
  'mobileApiKey',
  'firebaseServerKey',
  'googleMapsApiKey',
  'awsAccessKeyId',
  'awsSecretAccessKey',
] as const;

export function integrationSettingsForClient(value: unknown) {
  const integrations = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(integrations)) {
    if (SECRET_FIELDS.includes(key as (typeof SECRET_FIELDS)[number])) continue;
    if (key.endsWith('Configured')) continue;
    result[key] = field;
  }
  for (const key of SECRET_FIELDS) {
    const stored = integrations[key];
    const isPlaceholder = key === 'hopkidApiKey' && stored === 'HOPKID-MOBILE-ACCESS-API-KEY';
    const envKey = key === 'hopkidApiKey' ? process.env.HOPKID_API_KEY
      : key === 'mobileApiKey' ? process.env.MOBILE_API_KEY
      : key === 'firebaseServerKey' ? process.env.FIREBASE_SERVER_KEY
      : key === 'googleMapsApiKey' ? process.env.GOOGLE_MAPS_API_KEY
      : key === 'awsAccessKeyId' ? process.env.AWS_ACCESS_KEY_ID
      : process.env.AWS_SECRET_ACCESS_KEY;
    result[`${key}Configured`] = Boolean(
      (!isPlaceholder && typeof stored === 'string' && stored) ||
      (key === 'hopkidApiKey' && envKey === 'HOPKID-MOBILE-ACCESS-API-KEY' ? '' : envKey)
    );
  }
  return result;
}

export function mergeIntegrationSettings(existingValue: unknown, incomingValue: unknown) {
  const existing = existingValue && typeof existingValue === 'object'
    ? existingValue as Record<string, unknown>
    : {};
  const incoming = incomingValue && typeof incomingValue === 'object'
    ? incomingValue as Record<string, unknown>
    : {};
  const merged = { ...existing, ...incoming };
  for (const key of SECRET_FIELDS) {
    const value = incoming[key];
    // Empty inputs mean “keep the stored secret”; secrets are never returned
    // to the browser just to support editing other integration settings.
    if (typeof value !== 'string' || !value.trim()) {
      if (typeof existing[key] === 'string' && existing[key]) merged[key] = existing[key];
      else delete merged[key];
    } else {
      merged[key] = value.trim();
    }
  }
  for (const key of Object.keys(merged)) {
    if (key.endsWith('Configured')) delete merged[key];
  }
  return merged;
}

export function settingsForClient<T extends { integrations?: unknown }>(settings: T): T {
  return {
    ...settings,
    integrations: integrationSettingsForClient(settings.integrations),
  };
}
