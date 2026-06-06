export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: Date;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
}

export interface TrackingSession {
  id: string;
  employeeId: number;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  purpose: 'WORK' | 'FIELD' | 'CLIENT_VISIT' | 'OTHER';
  notes?: string;
  totalDistance?: number;
  duration?: number;
  locations: LocationPoint[];
}

export interface RouteHistory {
  id: string;
  employeeId: number;
  date: Date;
  route: LocationPoint[];
  startPoint: LocationPoint;
  endPoint: LocationPoint;
  distance: number;
  duration: number;
  purpose: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'INTERRUPTED';
}

export interface GeofenceEvent {
  id: string;
  employeeId: number;
  eventType: 'ENTER' | 'EXIT' | 'BREACH';
  location: LocationPoint;
  officeId: number;
  officeName: string;
  timestamp: Date;
  description: string;
}
