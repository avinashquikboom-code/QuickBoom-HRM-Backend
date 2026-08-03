import { prisma } from '../utils/db';

export interface GeofenceResult {
  isWithinGeofence: boolean;
  distance: number;
  officeId?: number;
  officeName?: string;
  maxRadius: number;
  coordinates: {
    userLat: number;
    userLon: number;
    officeLat: number;
    officeLon: number;
  };
}

export interface OfficeGeofence {
  id: number;
  name: string;
  code: string | null;
  address: string;
  latitude: number;
  longitude: number;
  idealRadiusMeters: number;
  maxPunchRadiusMeters: number;
  isActive: boolean;
}

class GeofenceService {
  /**
   * Calculate distance between two coordinates using Haversine formula
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
   * Check if user is within any office, store, or branch geofence
   */
  async checkGeofence(userLat: number, userLon: number, employeeId?: number, officeId?: number): Promise<GeofenceResult> {
    try {
      // Find the employee with their office, store, and branch relations
      const employee = employeeId ? await prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          office: true,
          store: true
        }
      }) : null;

      // Check if employee has an active APPROVED Remote Work Request for today
      if (employeeId) {
        const now = new Date();
        const empIdStr = String(employeeId);
        const activeRemote = await prisma.remoteWorkRequest.findFirst({
          where: {
            employeeId: empIdStr,
            status: 'APPROVED',
            fromDate: { lte: now },
            toDate: { gte: now }
          }
        });

        if (activeRemote) {
          console.log(`✅ [GeofenceService] Active remote work approved for employeeId=${employeeId}. Bypassing geofence.`);
          return {
            isWithinGeofence: true,
            distance: 0,
            officeId: employee?.officeId || undefined,
            officeName: 'Remote Work (Approved)',
            maxRadius: 999999,
            coordinates: {
              userLat,
              userLon,
              officeLat: userLat,
              officeLon: userLon
            }
          };
        }
      }

      const geofences: Array<{
        type: 'office' | 'store' | 'branch';
        id: number;
        name: string;
        latitude: number;
        longitude: number;
        maxRadius: number;
      }> = [];

      if (officeId) {
        const office = await prisma.office.findUnique({
          where: { id: officeId }
        });
        if (office && office.isActive) {
          geofences.push({
            type: 'office',
            id: office.id,
            name: office.name,
            latitude: office.latitude,
            longitude: office.longitude,
            maxRadius: (employee && employee.customPunchRadius) || office.maxPunchRadiusMeters || 50.0
          });
        }
      }

      if (employee) {
        if (!officeId && employee.office && employee.office.isActive) {
          geofences.push({
            type: 'office',
            id: employee.office.id,
            name: employee.office.name,
            latitude: employee.office.latitude,
            longitude: employee.office.longitude,
            maxRadius: employee.customPunchRadius || employee.office.maxPunchRadiusMeters || 50.0
          });
        }
        
        if (employee.store && employee.store.isActive) {
          if (employee.store.latitude !== null && employee.store.longitude !== null) {
            geofences.push({
              type: 'store',
              id: employee.store.id,
              name: `Store: ${employee.store.name}`,
              latitude: employee.store.latitude,
              longitude: employee.store.longitude,
              maxRadius: employee.customPunchRadius || employee.store.maxPunchRadiusMeters || 50.0
            });
          }
        }
      }

      // If no specific employee/office geofences found, fall back to checking all active offices
      if (geofences.length === 0) {
        const activeOffices = await prisma.office.findMany({
          where: { isActive: true }
        });
        for (const office of activeOffices) {
          // Skip offices with placeholder (0,0) coordinates — location not set yet
          if (office.latitude === 0 && office.longitude === 0) continue;
          geofences.push({
            type: 'office',
            id: office.id,
            name: office.name,
            latitude: office.latitude,
            longitude: office.longitude,
            maxRadius: office.maxPunchRadiusMeters
          });
        }
      }

      // Filter out any (0,0) placeholder coordinates from the employee-specific list too
      const validGeofences = geofences.filter(
        gf => !(gf.latitude === 0 && gf.longitude === 0)
      );

      if (validGeofences.length === 0) {
        // No valid geofence coordinates configured — allow punch gracefully
        console.warn(`[GeofenceService] No valid geofence coordinates found for employeeId=${employeeId}. Allowing punch.`);
        return {
          isWithinGeofence: true,
          distance: 0,
          officeId: undefined,
          officeName: 'No location configured',
          maxRadius: 0,
          coordinates: {
            userLat,
            userLon,
            officeLat: 0,
            officeLon: 0
          }
        };
      }

      // Check all available geofences and find the closest one
      let closestGeofence = validGeofences[0];
      let minDistance = Infinity;
      let isWithinGeofence = false;

      for (const gf of validGeofences) {
        const distance = this.calculateDistance(userLat, userLon, gf.latitude, gf.longitude);
        if (distance < minDistance) {
          minDistance = distance;
          closestGeofence = gf;
        }
        if (distance <= gf.maxRadius) {
          isWithinGeofence = true;
        }
      }

      return {
        isWithinGeofence,
        distance: minDistance,
        officeId: closestGeofence.type === 'office' ? closestGeofence.id : undefined,
        officeName: closestGeofence.name,
        maxRadius: closestGeofence.maxRadius,
        coordinates: {
          userLat,
          userLon,
          officeLat: closestGeofence.latitude,
          officeLon: closestGeofence.longitude
        }
      };
    } catch (error) {
      console.error('Geofence check error:', error);
      throw error;
    }
  }

  /**
   * Get all active offices with geofence information
   */
  async getAllOffices(): Promise<OfficeGeofence[]> {
    try {
      const offices = await prisma.office.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          latitude: true,
          longitude: true,
          idealRadiusMeters: true,
          maxPunchRadiusMeters: true,
          isActive: true
        },
        orderBy: { name: 'asc' }
      });

      return offices;
    } catch (error) {
      console.error('Get offices error:', error);
      throw error;
    }
  }

  /**
   * Create or update office geofence
   */
  async upsertOfficeGeofence(officeData: Partial<OfficeGeofence>): Promise<OfficeGeofence> {
    try {
      const office = await prisma.office.upsert({
        where: { id: officeData.id || 0 },
        update: {
          name: officeData.name,
          code: officeData.code,
          address: officeData.address,
          latitude: officeData.latitude,
          longitude: officeData.longitude,
          idealRadiusMeters: officeData.idealRadiusMeters,
          maxPunchRadiusMeters: officeData.maxPunchRadiusMeters,
          isActive: officeData.isActive ?? true
        },
        create: {
          name: officeData.name || 'New Office',
          code: officeData.code || `OFFICE_${Date.now()}`,
          address: officeData.address || '',
          latitude: officeData.latitude || 0,
          longitude: officeData.longitude || 0,
          idealRadiusMeters: officeData.idealRadiusMeters || 25,
          maxPunchRadiusMeters: officeData.maxPunchRadiusMeters || 25,
          isActive: officeData.isActive ?? true
        }
      });

      return {
        id: office.id,
        name: office.name,
        code: office.code,
        address: office.address,
        latitude: office.latitude,
        longitude: office.longitude,
        idealRadiusMeters: office.idealRadiusMeters,
        maxPunchRadiusMeters: office.maxPunchRadiusMeters,
        isActive: office.isActive
      };
    } catch (error) {
      console.error('Upsert office geofence error:', error);
      throw error;
    }
  }

  /**
   * Delete office geofence
   */
  async deleteOfficeGeofence(officeId: number): Promise<void> {
    try {
      await prisma.office.delete({
        where: { id: officeId }
      });
    } catch (error) {
      console.error('Delete office geofence error:', error);
      throw error;
    }
  }

  /**
   * Get geofence statistics
   */
  async getGeofenceStats(): Promise<{
    totalOffices: number;
    activeOffices: number;
    averageRadius: number;
    totalEmployees: number;
  }> {
    try {
      const [officeStats, employeeStats] = await Promise.all([
        prisma.office.aggregate({
          _count: { id: true },
          _avg: { maxPunchRadiusMeters: true },
          where: { isActive: true }
        }),
        prisma.employee.count({
          where: { officeId: { not: null } }
        })
      ]);

      return {
        totalOffices: officeStats._count.id,
        activeOffices: officeStats._count.id,
        averageRadius: Math.round(officeStats._avg.maxPunchRadiusMeters || 0),
        totalEmployees: employeeStats
      };
    } catch (error) {
      console.error('Get geofence stats error:', error);
      throw error;
    }
  }

  /**
   * Validate location coordinates
   */
  validateCoordinates(lat: number, lon: number): boolean {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  /**
   * Check if location is simulator location (0,0)
   */
  isSimulatorLocation(lat: number, lon: number): boolean {
    return lat === 0 && lon === 0;
  }

  /**
   * Get geofence breach events for an employee
   */
  async getGeofenceEvents(employeeId: number, limit: number = 50): Promise<any[]> {
    try {
      // This would typically query a geofence events table
      // For now, return empty array as this is a placeholder
      return [];
    } catch (error) {
      console.error('Get geofence events error:', error);
      throw error;
    }
  }

  /**
   * Get all office geofences
   */
  async getAllOfficeGeofences(): Promise<OfficeGeofence[]> {
    try {
      const offices = await prisma.office.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          latitude: true,
          longitude: true,
          idealRadiusMeters: true,
          maxPunchRadiusMeters: true,
          isActive: true
        }
      });

      return offices.map(office => ({
        id: office.id,
        name: office.name,
        code: office.code,
        address: office.address,
        latitude: office.latitude,
        longitude: office.longitude,
        idealRadiusMeters: office.idealRadiusMeters,
        maxPunchRadiusMeters: office.maxPunchRadiusMeters,
        isActive: office.isActive
      }));
    } catch (error) {
      console.error('Get all office geofences error:', error);
      throw error;
    }
  }

  /**
   * Get nearby offices within radius
   */
  async getNearbyOffices(
    userLat: number,
    userLon: number,
    radius: number = 5000
  ): Promise<OfficeGeofence[]> {
    try {
      const allOffices = await this.getAllOfficeGeofences();
      
      const nearbyOffices = allOffices.filter(office => {
        const distance = this.calculateDistance(userLat, userLon, office.latitude, office.longitude);
        return distance <= radius;
      });

      return nearbyOffices;
    } catch (error) {
      console.error('Get nearby offices error:', error);
      throw error;
    }
  }
}

export default new GeofenceService();
