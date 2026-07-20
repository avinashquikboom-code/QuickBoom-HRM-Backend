import { prisma } from '../utils/db';
import { LocationPoint, TrackingSession, RouteHistory, GeofenceEvent } from '../models/locationTracking';
import { getWebSocketInstance } from '../utils/websocketSingleton';

class LiveTrackingService {
  private activeSessions: Map<string, TrackingSession> = new Map();
  private locationBuffer: Map<string, LocationPoint[]> = new Map();

  /**
   * Start a new tracking session for an employee
   */
  async startTrackingSession(employeeId: string, purpose: string, notes?: string): Promise<TrackingSession> {
    try {
      const sessionId = `session_${employeeId}_${Date.now()}`;
      const session: TrackingSession = {
        id: sessionId,
        employeeId,
        startTime: new Date(),
        isActive: true,
        purpose: purpose as any,
        notes,
        locations: []
      };

      // Store in memory and database
      this.activeSessions.set(sessionId, session);
      
      // Initialize location buffer for employee
      if (!this.locationBuffer.has(employeeId)) {
        this.locationBuffer.set(employeeId, []);
      }

      // Broadcast session start to HR
      try {
        await getWebSocketInstance().broadcastNotification(employeeId, {
          title: 'Live Tracking Started',
          body: `Employee has started ${purpose} tracking session.`,
          type: 'tracking_started',
          sessionId,
          purpose
        });
      } catch (wsError) {
        console.error('❌ Failed to broadcast tracking start:', wsError);
      }

      return session;
    } catch (error) {
      console.error('Start tracking session error:', error);
      throw error;
    }
  }

  /**
   * Stop an active tracking session
   */
  async stopTrackingSession(sessionId: string): Promise<TrackingSession> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error('Tracking session not found');
      }

      session.endTime = new Date();
      session.isActive = false;

      // Calculate total distance and duration
      session.duration = session.endTime.getTime() - session.startTime.getTime();
      session.totalDistance = this.calculateTotalDistance(session.locations);

      // Save to database (would typically save to a tracking_sessions table)
      // For now, just update in memory

      // Broadcast session end to HR
      try {
        await getWebSocketInstance().broadcastNotification(session.employeeId, {
          title: 'Live Tracking Stopped',
          body: `Employee has ended ${session.purpose} tracking session.`,
          type: 'tracking_stopped',
          sessionId,
          duration: session.duration,
          distance: session.totalDistance
        });
      } catch (wsError) {
        console.error('❌ Failed to broadcast tracking stop:', wsError);
      }

      return session;
    } catch (error) {
      console.error('Stop tracking session error:', error);
      throw error;
    }
  }

  /**
   * Update employee location
   */
  async updateLocation(employeeId: string, location: LocationPoint): Promise<void> {
    try {
      // Validate coordinates
      if (!this.isValidLocation(location)) {
        throw new Error('Invalid location coordinates');
      }

      // Add to location buffer
      const buffer = this.locationBuffer.get(employeeId) || [];
      buffer.push(location);
      
      // Keep only last 100 points to prevent memory issues
      if (buffer.length > 100) {
        buffer.shift();
      }
      this.locationBuffer.set(employeeId, buffer);

      // Update active session
      const activeSession = Array.from(this.activeSessions.values())
        .find(s => s.employeeId === employeeId && s.isActive);
      
      if (activeSession) {
        activeSession.locations.push(location);
      }

      // Check for geofence events
      await this.checkGeofenceEvents(employeeId, location);

      // Broadcast location update to HR (throttled)
      if (buffer.length % 5 === 0) { // Every 5th location update
        try {
          await getWebSocketInstance().broadcastNotification(employeeId, {
            title: location.isLocationEnabled === false ? 'Location Disabled' : 'Location Update',
            body: location.isLocationEnabled === false 
              ? 'Employee has turned off device location' 
              : 'Employee location updated',
            type: 'location_update',
            isLocationEnabled: location.isLocationEnabled,
            location: {
              latitude: location.latitude,
              longitude: location.longitude,
              timestamp: location.timestamp,
              accuracy: location.accuracy
            }
          });
        } catch (wsError) {
          console.error('❌ Failed to broadcast location update:', wsError);
        }
      }
    } catch (error) {
      console.error('Update location error:', error);
      throw error;
    }
  }

  /**
   * Get current location of employee
   */
  async getCurrentLocation(employeeId: string): Promise<LocationPoint | null> {
    try {
      const buffer = this.locationBuffer.get(employeeId);
      return buffer && buffer.length > 0 ? buffer[buffer.length - 1] : null;
    } catch (error) {
      console.error('Get current location error:', error);
      throw error;
    }
  }

  
  /**
   * Get employee route history
   */
  async getRouteHistory(employeeId: string, startDate: Date, endDate: Date): Promise<RouteHistory[]> {
    try {
      // This would typically query a route_history table
      // For now, return empty array as placeholder
      return [];
    } catch (error) {
      console.error('Get route history error:', error);
      throw error;
    }
  }

  /**
   * Get geofence events for employee
   */
  async getGeofenceEvents(employeeId: string, limit: number = 50): Promise<GeofenceEvent[]> {
    try {
      const events = this.geofenceEvents.get(employeeId) || [];
      // Return most recent events first, limited by the specified number
      return events
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      console.error('Get geofence events error:', error);
      throw error;
    }
  }

  /**
   * Get live tracking statistics
   */
  async getTrackingStats(): Promise<{
    activeSessions: number;
    totalEmployeesTracked: number;
    averageSessionDuration: number;
    totalDistanceTracked: number;
  }> {
    try {
      const activeSessions = Array.from(this.activeSessions.values()).filter(s => s.isActive);
      const totalDistance = activeSessions.reduce((sum, session) => 
        sum + (session.totalDistance || 0), 0);
      
      const avgDuration = activeSessions.length > 0 
        ? activeSessions.reduce((sum, session) => 
            sum + (session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0), 0) / activeSessions.length
        : 0;

      return {
        activeSessions: activeSessions.length,
        totalEmployeesTracked: this.locationBuffer.size,
        averageSessionDuration: avgDuration,
        totalDistanceTracked: totalDistance
      };
    } catch (error) {
      console.error('Get tracking stats error:', error);
      throw error;
    }
  }

  /**
   * Calculate total distance from location points
   */
  private calculateTotalDistance(locations: LocationPoint[]): number {
    let totalDistance = 0;
    for (let i = 1; i < locations.length; i++) {
      totalDistance += this.calculateDistance(
        locations[i - 1].latitude,
        locations[i - 1].longitude,
        locations[i].latitude,
        locations[i].longitude
      );
    }
    return totalDistance;
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Validate location coordinates
   */
  private isValidLocation(location: LocationPoint): boolean {
    return location.latitude >= -90 && location.latitude <= 90 &&
           location.longitude >= -180 && location.longitude <= 180 &&
           location.timestamp instanceof Date;
  }

  /**
   * Check for geofence events
   */
  private async checkGeofenceEvents(employeeId: string, location: LocationPoint): Promise<void> {
    try {
      // Get employee's assigned office
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { 
          office: true,
          user: {
            include: {
              profile: true
            }
          }
        }
      });

      if (!employee || !employee.office) {
        return; // No office assigned, skip geofence check
      }

      const office = employee.office;
      const officeLat = office.latitude;
      const officeLon = office.longitude;
      const maxRadius = office.maxPunchRadiusMeters || 25; // Default 25 meters

      // Calculate distance to office
      const distance = this.calculateDistance(
        location.latitude,
        location.longitude,
        officeLat,
        officeLon
      );

      const isWithinGeofence = distance <= maxRadius;

      // Get previous geofence status (stored in a simple in-memory map for this session)
      const previousStatus = this.geofenceStatusMap.get(employeeId);
      const statusChanged = previousStatus !== undefined && previousStatus !== isWithinGeofence;

      // Update current status
      this.geofenceStatusMap.set(employeeId, isWithinGeofence);

      // If status changed, create event and broadcast
      if (statusChanged) {
        const eventType = isWithinGeofence ? 'ENTERED_GEOFENCE' : 'EXITED_GEOFENCE';
        
        // Create geofence event (would typically save to database)
        const geofenceEvent: GeofenceEvent = {
          id: `geofence_${employeeId}_${Date.now()}`,
          employeeId,
          eventType: eventType as any,
          location,
          officeId: office.id,
          officeName: office.name,
          distance,
          timestamp: new Date(),
          description: isWithinGeofence 
            ? `Employee entered office geofence at ${distance.toFixed(0)}m distance`
            : `Employee exited office geofence at ${distance.toFixed(0)}m distance`
        };

        // Store event (in memory for now)
        if (!this.geofenceEvents.has(employeeId)) {
          this.geofenceEvents.set(employeeId, []);
        }
        const events = this.geofenceEvents.get(employeeId)!;
        events.push(geofenceEvent);
        
        // Keep only last 100 events
        if (events.length > 100) {
          events.shift();
        }

        // Broadcast notification to HR/Admin
        try {
          await getWebSocketInstance().broadcastNotification(employeeId, {
            title: isWithinGeofence ? 'Employee Entered Office Area' : 'Employee Left Office Area',
            body: `${employee.user?.profile?.fullName || 'Employee'} has ${isWithinGeofence ? 'entered' : 'left'} the office geofence. Distance: ${distance.toFixed(0)}m`,
            type: 'geofence_event',
            eventType,
            employeeId,
            employeeName: employee.user?.profile?.fullName || 'Unknown',
            location: {
              latitude: location.latitude,
              longitude: location.longitude,
              timestamp: location.timestamp
            },
            office: {
              name: office.name,
              address: office.address
            },
            distance,
            isWithinGeofence
          });
        } catch (wsError) {
          console.error('❌ Failed to broadcast geofence event:', wsError);
        }

        console.log(`📍 Geofence event: ${eventType} for employee ${employeeId}, distance: ${distance.toFixed(0)}m`);
      }
    } catch (error) {
      console.error('Check geofence events error:', error);
    }
  }

  // In-memory storage for geofence status and events
  private geofenceStatusMap: Map<string, boolean> = new Map();
  private geofenceEvents: Map<string, GeofenceEvent[]> = new Map();

  /**
   * Get active sessions for an employee
   */
  async getActiveSessions(employeeId: string): Promise<TrackingSession[]> {
    try {
      const sessions: TrackingSession[] = [];
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.employeeId === employeeId && session.isActive) {
          sessions.push(session);
        }
      }
      return sessions;
    } catch (error) {
      console.error('Get active sessions error:', error);
      throw error;
    }
  }

  /**
   * Get location history for an employee
   */
  async getLocationHistory(employeeId: string, sessionId?: string, limit: number = 100): Promise<LocationPoint[]> {
    try {
      const locations = this.locationBuffer.get(employeeId) || [];
      
      // Filter by session if provided
      let filteredLocations = locations;
      if (sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
          filteredLocations = locations.filter(loc => 
            loc.timestamp >= session.startTime && 
            (!session.endTime || loc.timestamp <= session.endTime)
          );
        }
      }
      
      // Sort by timestamp (newest first) and limit
      return filteredLocations
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      console.error('Get location history error:', error);
      throw error;
    }
  }

  /**
   * Get live locations of all employees (HR/Admin only)
   */
  async getLiveLocations(officeId?: string): Promise<any[]> {
    try {
      const liveLocations: any[] = [];
      
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.isActive && session.locations.length > 0) {
          const latestLocation = session.locations[session.locations.length - 1];
          
          // Get employee details
          const employee = await prisma.employee.findUnique({
            where: { id: session.employeeId },
            include: {
              user: { select: { email: true, profile: { select: { fullName: true } } } },
              office: { select: { id: true, name: true, address: true } }
            }
          });
          
          if (employee) {
            if (officeId !== undefined && employee.officeId !== officeId) {
              continue;
            }
            liveLocations.push({
              sessionId,
              employeeId: session.employeeId,
              employeeName: employee.user?.profile?.fullName || 'Unknown',
              employeeEmail: employee.user?.email || '',
              officeName: employee.office?.name || '',
              purpose: session.purpose,
              startTime: session.startTime,
              currentLocation: latestLocation,
              totalLocations: session.locations.length,
              isLocationEnabled: latestLocation.isLocationEnabled !== false
            });
          }
        }
      }
      
      return liveLocations;
    } catch (error) {
      console.error('Get live locations error:', error);
      throw error;
    }
  }

  /**
   * Clean up old data
   */
  async cleanup(): Promise<void> {
    try {
      // Clean up completed sessions older than 24 hours
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (!session.isActive && session.endTime && session.endTime < dayAgo) {
          this.activeSessions.delete(sessionId);
        }
      }

      // Clean up location buffers for inactive employees
      for (const [employeeId, buffer] of this.locationBuffer.entries()) {
        if (buffer.length === 0 || buffer[buffer.length - 1].timestamp < dayAgo) {
          this.locationBuffer.delete(employeeId);
        }
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

export default new LiveTrackingService();
