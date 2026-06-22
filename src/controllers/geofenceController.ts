import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import geofenceService from '../services/geofenceService';
import { prisma } from '../utils/db';

// ==========================================
// Geofence Controller
// ==========================================

export const checkGeofence = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { latitude, longitude, officeId } = req.body;

    if (!latitude || !longitude) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_COORDINATES'
      });
      return;
    }

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { office: true }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const result = await geofenceService.checkGeofence(
      latitude,
      longitude,
      officeId || employee.officeId
    );

    // Fetch enableGeofence from settings
    const systemSettings = await prisma.systemSetting.findUnique({
      where: { id: 1 }
    });
    const rawAttendance = (systemSettings?.attendance as any) || {};
    const enableGeofence = rawAttendance.enableGeofence !== undefined ? rawAttendance.enableGeofence : true;
    const enablePunchOutGeofence = rawAttendance.enablePunchOutGeofence !== undefined ? rawAttendance.enablePunchOutGeofence : false;

    res.json({
      success: true,
      message: 'Geofence check completed.',
      result: {
        ...result,
        isWithinGeofence: enableGeofence ? result.isWithinGeofence : true,
        enableGeofence,
        enablePunchOutGeofence
      }
    });
  } catch (error) {
    console.error('Check geofence error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check geofence.',
      errorCode: 'CHECK_GEOFENCE_ERROR'
    });
  }
};

export const getOfficeGeofences = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const geofences = await geofenceService.getAllOfficeGeofences();

    res.json({
      success: true,
      geofences
    });
  } catch (error) {
    console.error('Get office geofences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get office geofences.',
      errorCode: 'GET_OFFICE_GEOFENCES_ERROR'
    });
  }
};

export const getGeofenceStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_COORDINATES'
      });
      return;
    }

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { office: true }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const result = await geofenceService.checkGeofence(
      parseFloat(latitude as string),
      parseFloat(longitude as string),
      employee.officeId || undefined
    );

    // Fetch enableGeofence from settings
    const systemSettings = await prisma.systemSetting.findUnique({
      where: { id: 1 }
    });
    const rawAttendance = (systemSettings?.attendance as any) || {};
    const enableGeofence = rawAttendance.enableGeofence !== undefined ? rawAttendance.enableGeofence : true;
    const enablePunchOutGeofence = rawAttendance.enablePunchOutGeofence !== undefined ? rawAttendance.enablePunchOutGeofence : false;

    const finalIsWithinGeofence = enableGeofence ? result.isWithinGeofence : true;

    res.json({
      success: true,
      status: finalIsWithinGeofence ? 'WITHIN_GEOFENCE' : 'OUTSIDE_GEOFENCE',
      result: {
        ...result,
        isWithinGeofence: finalIsWithinGeofence,
        enableGeofence,
        enablePunchOutGeofence
      }
    });
  } catch (error) {
    console.error('Get geofence status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get geofence status.',
      errorCode: 'GET_GEOFENCE_STATUS_ERROR'
    });
  }
};

export const getNearbyOffices = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { latitude, longitude, radius = 5000 } = req.query;

    if (!latitude || !longitude) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_COORDINATES'
      });
      return;
    }

    const nearbyOffices = await geofenceService.getNearbyOffices(
      parseFloat(latitude as string),
      parseFloat(longitude as string),
      parseInt(radius as string)
    );

    res.json({
      success: true,
      nearbyOffices
    });
  } catch (error) {
    console.error('Get nearby offices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby offices.',
      errorCode: 'GET_NEARBY_OFFICES_ERROR'
    });
  }
};
