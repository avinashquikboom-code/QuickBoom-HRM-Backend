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
   * Check if user is within any office geofence
   */
  async checkGeofence(userLat: number, userLon: number, employeeOfficeId?: number): Promise<GeofenceResult> {
    try {
      // Get all active offices or specific office if provided
      const offices = await prisma.office.findMany({
        where: {
          ...(employeeOfficeId ? { id: employeeOfficeId } : {}),
          isActive: true
        },
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

      if (offices.length === 0) {
        throw new Error('No active offices found');
      }

      // If employee has specific office, check only that office
      if (employeeOfficeId) {
        const office = offices[0];
        const distance = this.calculateDistance(userLat, userLon, office.latitude, office.longitude);
        const isWithin = distance <= office.maxPunchRadiusMeters;

        return {
          isWithinGeofence: isWithin,
          distance,
          officeId: office.id,
          officeName: office.name,
          maxRadius: office.maxPunchRadiusMeters,
          coordinates: {
            userLat,
            userLon,
            officeLat: office.latitude,
            officeLon: office.longitude
          }
        };
      }

      // Check all offices and find the closest one
      let closestOffice: OfficeGeofence | null = null;
      let minDistance = Infinity;
      let isWithinAnyGeofence = false;

      for (const office of offices) {
        const distance = this.calculateDistance(userLat, userLon, office.latitude, office.longitude);
        
        if (distance < minDistance) {
          minDistance = distance;
          closestOffice = office;
        }

        if (distance <= office.maxPunchRadiusMeters) {
          isWithinAnyGeofence = true;
        }
      }

      return {
        isWithinGeofence: isWithinAnyGeofence,
        distance: minDistance,
        officeId: closestOffice?.id,
        officeName: closestOffice?.name,
        maxRadius: closestOffice?.maxPunchRadiusMeters || 0,
        coordinates: {
          userLat,
          userLon,
          officeLat: closestOffice?.latitude || 0,
          officeLon: closestOffice?.longitude || 0
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
          maxPunchRadiusMeters: officeData.maxPunchRadiusMeters || 50,
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
}

export default new GeofenceService();
