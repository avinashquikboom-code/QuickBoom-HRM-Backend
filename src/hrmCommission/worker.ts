import cron from 'node-cron';
import { projectStoredHopkidLogs } from './projection';
export function initHrmCommissionProjection() {
  // Disabled until an administrator explicitly enables HRM-owned source settings.
  cron.schedule('* * * * *', () => {
    void projectStoredHopkidLogs().catch(error => console.error('[HRM commission worker]', error.message));
  });
}
