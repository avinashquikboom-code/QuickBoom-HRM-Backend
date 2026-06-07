import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

// ==========================================
// Distance Tracking Controller for Mobile
// ==========================================

/**
 * Calculate distance between two coordinates using Haversine formula
 */
const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
};

/**
 * @swagger
 * /api/mobile/distance/current:
 *   get:
 *     summary: Get current distance from office
 *     tags: [Mobile Distance Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: Current latitude
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: Current longitude
 *     responses:
 *       200:
 *         description: Distance calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     distance:
 *                       type: number
 *                       description: Distance in kilometers
 *                     officeName:
 *                       type: string
 *                     officeAddress:
 *                       type: string
 *                     isWithinRadius:
 *                       type: boolean
 *                     officeRadius:
 *                       type: number
 *                       description: Office radius in meters
 *                     coordinates:
 *                       type: object
 *                       properties:
 *                         current:
 *                           type: object
 *                           properties:
 *                             latitude:
 *                               type: number
 *                             longitude:
 *                               type: number
 *                         office:
 *                           type: object
 *                           properties:
 *                             latitude:
 *                               type: number
 *                             longitude:
 *                               type: number
 *       400:
 *         description: Bad request - missing coordinates
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Office not found
 *       500:
 *         description: Internal server error
 */
export const getCurrentDistance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { latitude, longitude } = req.query;
    const userId = req.user?.id;

    if (!latitude || !longitude) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
        errorCode: 'MISSING_COORDINATES'
      });
      return;
    }

    const currentLat = parseFloat(latitude as string);
    const currentLon = parseFloat(longitude as string);

    if (isNaN(currentLat) || isNaN(currentLon)) {
      res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude values',
        errorCode: 'INVALID_COORDINATES'
      });
      return;
    }

    // Get employee's office information
    const employee = await prisma.employee.findUnique({
      where: { userId: userId },
      include: {
        office: true
      }
    });

    if (!employee || !employee.office) {
      res.status(404).json({
        success: false,
        message: 'Employee office not found',
        errorCode: 'OFFICE_NOT_FOUND'
      });
      return;
    }

    const office = employee.office;
    
    // Calculate distance
    const distance = calculateDistance(
      currentLat,
      currentLon,
      office.latitude,
      office.longitude
    );

    const isWithinRadius = (distance * 1000) <= office.maxPunchRadiusMeters; // Convert km to meters

    res.json({
      success: true,
      data: {
        distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
        officeName: office.name,
        officeAddress: office.address,
        isWithinRadius,
        officeRadius: office.maxPunchRadiusMeters,
        coordinates: {
          current: {
            latitude: currentLat,
            longitude: currentLon
          },
          office: {
            latitude: office.latitude,
            longitude: office.longitude
          }
        },
        message: isWithinRadius 
          ? 'You are within the office radius' 
          : `You are ${Math.round((distance * 1000 - office.maxPunchRadiusMeters))} meters outside the office radius`
      }
    });

  } catch (error) {
    console.error('Distance tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate distance',
      errorCode: 'DISTANCE_CALCULATION_ERROR'
    });
  }
};

/**
 * @swagger
 * /api/mobile/distance/history:
 *   get:
 *     summary: Get distance tracking history
 *     tags: [Mobile Distance Tracking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of records to return
 *     responses:
 *       200:
 *         description: Distance history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     history:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           checkIn:
 *                             type: string
 *                             format: date-time
 *                           checkOut:
 *                             type: string
 *                             format: date-time
 *                           distance:
 *                             type: number
 *                           isWithinRadius:
 *                             type: boolean
 *                           locationStatus:
 *                             type: string
 *                             enum: [IN_OFFICE, OUTSIDE_OFFICE]
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalRecords:
 *                           type: integer
 *                         averageDistance:
 *                           type: number
 *                         withinRadiusPercentage:
 *                           type: number
 *                         farthestDistance:
 *                           type: number
 *                         closestDistance:
 *                           type: number
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const getDistanceHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate, limit = '50' } = req.query;
    const userId = req.user?.id;

    // Get employee's office information
    const employee = await prisma.employee.findUnique({
      where: { userId: userId },
      include: {
        office: true
      }
    });

    if (!employee || !employee.office) {
      res.status(404).json({
        success: false,
        message: 'Employee office not found',
        errorCode: 'OFFICE_NOT_FOUND'
      });
      return;
    }

    const office = employee.office;
    const limitNum = parseInt(limit as string);

    // Build date filter
    let dateFilter = {};
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        date: {
          gte: start,
          lte: end
        }
      };
    }

    // Get attendance records with location data
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        employeeId: employee.id,
        ...dateFilter,
        latitude: { not: null },
        longitude: { not: null }
      },
      select: {
        date: true,
        checkIn: true,
        checkOut: true,
        latitude: true,
        longitude: true,
        status: true
      },
      orderBy: { date: 'desc' },
      take: limitNum
    });

    // Process distance data
    const history = attendanceRecords.map(record => {
      if (!record.latitude || !record.longitude) {
        return null;
      }

      const distance = calculateDistance(
        record.latitude,
        record.longitude,
        office.latitude,
        office.longitude
      );

      const isWithinRadius = (distance * 1000) <= office.maxPunchRadiusMeters;
      const locationStatus = isWithinRadius ? 'IN_OFFICE' : 'OUTSIDE_OFFICE';

      return {
        date: record.date,
        checkIn: record.checkIn?.toISOString(),
        checkOut: record.checkOut?.toISOString(),
        distance: Math.round(distance * 100) / 100,
        isWithinRadius,
        locationStatus,
        status: record.status
      };
    }).filter(record => record !== null);

    // Calculate summary statistics
    const totalRecords = history.length;
    const withinRadiusCount = history.filter(r => r.isWithinRadius).length;
    const distances = history.map(r => r.distance);
    const averageDistance = distances.length > 0 
      ? distances.reduce((sum, d) => sum + d, 0) / distances.length 
      : 0;
    const farthestDistance = distances.length > 0 ? Math.max(...distances) : 0;
    const closestDistance = distances.length > 0 ? Math.min(...distances) : 0;
    const withinRadiusPercentage = totalRecords > 0 ? (withinRadiusCount / totalRecords) * 100 : 0;

    res.json({
      success: true,
      data: {
        history,
        summary: {
          totalRecords,
          averageDistance: Math.round(averageDistance * 100) / 100,
          withinRadiusPercentage: Math.round(withinRadiusPercentage * 100) / 100,
          farthestDistance: Math.round(farthestDistance * 100) / 100,
          closestDistance: Math.round(closestDistance * 100) / 100,
          officeName: office.name,
          officeRadius: office.maxPunchRadiusMeters
        }
      }
    });

  } catch (error) {
    console.error('Distance history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve distance history',
      errorCode: 'DISTANCE_HISTORY_ERROR'
    });
  }
};

/**
 * @swagger
 * /api/mobile/distance/office-info:
 *   get:
 *     summary: Get office information for distance tracking
 *     tags: [Mobile Distance Tracking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Office information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     office:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         address:
 *                           type: string
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                         radius:
 *                           type: number
 *                         timezone:
 *                           type: string
 *                         workingHours:
 *                           type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Office not found
 *       500:
 *         description: Internal server error
 */
export const getOfficeInfo = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Get employee's office information
    const employee = await prisma.employee.findUnique({
      where: { userId: userId },
      include: {
        office: true
      }
    });

    if (!employee || !employee.office) {
      res.status(404).json({
        success: false,
        message: 'Employee office not found',
        errorCode: 'OFFICE_NOT_FOUND'
      });
      return;
    }

    const office = employee.office;

    res.json({
      success: true,
      data: {
        office: {
          id: office.id,
          name: office.name,
          address: office.address,
          latitude: office.latitude,
          longitude: office.longitude,
          radius: office.maxPunchRadiusMeters,
          idealRadius: office.idealRadiusMeters
        }
      }
    });

  } catch (error) {
    console.error('Office info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve office information',
      errorCode: 'OFFICE_INFO_ERROR'
    });
  }
};
