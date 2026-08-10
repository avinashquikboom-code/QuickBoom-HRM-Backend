/**
 * Time formatting utilities — Used by both admin panel + mobile API
 */

// Format date to readable format (10 Aug 2026)
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch (e) {
    return '-';
  }
}

// Format time to readable format (09:54 AM)
export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return '-';
  }
}

// Calculate working hours between punch in/out
export function calculateWorkingHours(
  checkIn: string | Date | null | undefined,
  checkOut: string | Date | null | undefined
): string {
  if (!checkIn || !checkOut) return '-';
  try {
    const inTime = typeof checkIn === 'string' ? new Date(checkIn) : checkIn;
    const outTime = typeof checkOut === 'string' ? new Date(checkOut) : checkOut;
    
    const diffMs = outTime.getTime() - inTime.getTime();
    if (diffMs <= 0) return '-';
    
    const totalMins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  } catch (e) {
    return '-';
  }
}

// Calculate late arrival (minutes after 9:00 AM)
export function calculateLateness(checkInTime: string | Date | null | undefined): number {
  if (!checkInTime) return 0;
  try {
    const checkIn = typeof checkInTime === 'string' ? new Date(checkInTime) : checkInTime;
    if (isNaN(checkIn.getTime())) return 0;
    const scheduleTime = new Date(checkIn);
    scheduleTime.setHours(9, 0, 0, 0); // 9:00 AM
    
    const diff = checkIn.getTime() - scheduleTime.getTime();
    if (diff <= 0) return 0;
    
    return Math.floor(diff / (1000 * 60)); // Return minutes late
  } catch (e) {
    return 0;
  }
}
