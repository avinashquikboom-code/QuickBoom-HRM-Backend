import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import liveTrackingService from '../services/liveTrackingService';
import { prisma } from '../utils/db';

// ==========================================
// Live Tracking Controller
// ==========================================

export const startTrackingSession = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { purpose, notes } = req.body;

    if (!purpose) {
      res.status(400).json({
        success: false,
        message: 'Purpose is required for tracking session.',
        errorCode: 'MISSING_PURPOSE'
      });
      return;
    }

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const session = await liveTrackingService.startTrackingSession(
      employee.id,
      purpose,
      notes
    );

    res.json({
      success: true,
      message: 'Tracking session started successfully.',
      session
    });
  } catch (error) {
    console.error('Start tracking session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start tracking session.',
      errorCode: 'START_TRACKING_ERROR'
    });
  }
};

export const stopTrackingSession = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({
        success: false,
        message: 'Session ID is required.',
        errorCode: 'MISSING_SESSION_ID'
      });
      return;
    }

    const session = await liveTrackingService.stopTrackingSession(sessionId);

    res.json({
      success: true,
      message: 'Tracking session stopped successfully.',
      session
    });
  } catch (error) {
    console.error('Stop tracking session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop tracking session.',
      errorCode: 'STOP_TRACKING_ERROR'
    });
  }
};

export const updateLocation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { latitude, longitude, accuracy, speed, heading, altitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_COORDINATES'
      });
      return;
    }

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const location = {
      latitude,
      longitude,
      timestamp: new Date(),
      accuracy,
      speed,
      heading,
      altitude
    };

    await liveTrackingService.updateLocation(employee.id, location);

    res.json({
      success: true,
      message: 'Location updated successfully.',
      location
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location.',
      errorCode: 'UPDATE_LOCATION_ERROR'
    });
  }
};

export const getActiveSessions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const sessions = await liveTrackingService.getActiveSessions(employee.id);

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('Get active sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active sessions.',
      errorCode: 'GET_ACTIVE_SESSIONS_ERROR'
    });
  }
};

export const getLocationHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { sessionId, limit = 100 } = req.query;

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const history = await liveTrackingService.getLocationHistory(
      employee.id,
      sessionId as string,
      parseInt(limit as string)
    );

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Get location history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get location history.',
      errorCode: 'GET_LOCATION_HISTORY_ERROR'
    });
  }
};

export const getLiveLocations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Check if user has HR or Admin role
    if (req.user?.role !== 'HR' && req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({
        success: false,
        message: 'Access denied. HR/Admin access required.',
        errorCode: 'ACCESS_DENIED'
      });
      return;
    }

    const liveLocations = await liveTrackingService.getLiveLocations();

    res.json({
      success: true,
      locations: liveLocations
    });
  } catch (error) {
    console.error('Get live locations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get live locations.',
      errorCode: 'GET_LIVE_LOCATIONS_ERROR'
    });
  }
};

export const getCurrentLocation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    
    // Get employee information (for own location or HR viewing others)
    let targetEmployeeId: number;
    
    if (employeeId) {
      // HR/Admin viewing another employee's location
      const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
      targetEmployeeId = parseInt(employeeIdStr);
    } else {
      // Employee viewing their own location
      const employee = await prisma.employee.findFirst({
        where: { userId: req.user?.id }
      });
      
      if (!employee) {
        res.status(404).json({
          success: false,
          message: 'Employee record not found.',
          errorCode: 'EMPLOYEE_NOT_FOUND'
        });
        return;
      }
      
      targetEmployeeId = employee.id;
    }

    const location = await liveTrackingService.getCurrentLocation(targetEmployeeId);

    res.json({
      success: true,
      location
    });
  } catch (error) {
    console.error('Get current location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get current location.',
      errorCode: 'GET_LOCATION_ERROR'
    });
  }
};


export const getRouteHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'Start date and end date are required.',
        errorCode: 'MISSING_DATES'
      });
      return;
    }

    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const targetEmployeeId = parseInt(employeeIdStr);
    const startDateStr = Array.isArray(startDate) ? startDate[0] : startDate;
    const endDateStr = Array.isArray(endDate) ? endDate[0] : endDate;
    const start = new Date(startDateStr as string);
    const end = new Date(endDateStr as string);

    const routeHistory = await liveTrackingService.getRouteHistory(
      targetEmployeeId,
      start,
      end
    );

    res.json({
      success: true,
      routeHistory
    });
  } catch (error) {
    console.error('Get route history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get route history.',
      errorCode: 'GET_ROUTE_HISTORY_ERROR'
    });
  }
};

export const getTrackingStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const stats = await liveTrackingService.getTrackingStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get tracking stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tracking statistics.',
      errorCode: 'GET_TRACKING_STATS_ERROR'
    });
  }
};

export const getGeofenceEvents = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId } = req.params;
    const { limit = '50' } = req.query as { limit: string };

    const employeeIdStr = Array.isArray(employeeId) ? employeeId[0] : employeeId;
    const targetEmployeeId = parseInt(employeeIdStr);
    const limitNum = parseInt(limit, 10);
    const events = await liveTrackingService.getGeofenceEvents(
      targetEmployeeId,
      limitNum
    );

    res.json({
      success: true,
      events
    });
  } catch (error) {
    console.error('Get geofence events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get geofence events.',
      errorCode: 'GET_GEOFENCE_EVENTS_ERROR'
    });
  }
};
