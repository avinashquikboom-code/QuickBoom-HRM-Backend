import { Request, Response } from 'express';
import { firebaseNotificationService } from '../../services/firebaseNotificationService';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';

// Test Firebase connection
export const testFirebaseConnection = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const isConnected = await firebaseNotificationService.testConnection();
    
    res.json({
      success: true,
      message: isConnected ? 'Firebase connection successful' : 'Firebase connection failed',
      connected: isConnected,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Firebase connection test error:', error);
    res.status(500).json({
      success: false,
      message: 'Error testing Firebase connection',
      errorCode: 'FIREBASE_CONNECTION_ERROR'
    });
  }
};

// Send notification to specific user
export const sendNotificationToUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId, title, body, data, options } = req.body;

    if (!userId || !title || !body) {
      res.status(400).json({
        success: false,
        message: 'userId, title, and body are required',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const response = await firebaseNotificationService.sendNotificationToUser(
      userId,
      title,
      body,
      data,
      options
    );

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: response.responses.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending notification',
      errorCode: 'SEND_NOTIFICATION_ERROR'
    });
  }
};

// Send notification to users by role
export const sendNotificationToRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { role, title, body, data, options } = req.body;

    if (!role || !title || !body) {
      res.status(400).json({
        success: false,
        message: 'role, title, and body are required',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const response = await firebaseNotificationService.sendNotificationToRole(
      role,
      title,
      body,
      data,
      options
    );

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: response.responses.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Send notification to role error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending notification to role',
      errorCode: 'SEND_NOTIFICATION_ROLE_ERROR'
    });
  }
};

// Send notification to users by department
export const sendNotificationToDepartment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { departmentId, title, body, data, options } = req.body;

    if (!departmentId || !title || !body) {
      res.status(400).json({
        success: false,
        message: 'departmentId, title, and body are required',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const response = await firebaseNotificationService.sendNotificationToDepartment(
      departmentId,
      title,
      body,
      data,
      options
    );

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: response.responses.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Send notification to department error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending notification to department',
      errorCode: 'SEND_NOTIFICATION_DEPARTMENT_ERROR'
    });
  }
};

// Send notification to all users
export const sendNotificationToAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, body, data, options } = req.body;

    if (!title || !body) {
      res.status(400).json({
        success: false,
        message: 'title and body are required',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const response = await firebaseNotificationService.sendNotificationToAll(
      title,
      body,
      data,
      options
    );

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: response.responses.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Send notification to all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending notification to all users',
      errorCode: 'SEND_NOTIFICATION_ALL_ERROR'
    });
  }
};

// Send test notification to current user
export const sendTestNotification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, body, data } = req.body;
    
    const notificationTitle = title || 'Test Notification';
    const notificationBody = body || 'This is a test notification from QuickBoom HRM';
    const notificationData = {
      ...data,
      type: 'test',
      timestamp: new Date().toISOString(),
    };

    const response = await firebaseNotificationService.sendNotificationToUser(
      req.user!.id,
      notificationTitle,
      notificationBody,
      notificationData
    );

    res.json({
      success: true,
      message: 'Test notification sent successfully',
      data: {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: response.responses.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Send test notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending test notification',
      errorCode: 'SEND_TEST_NOTIFICATION_ERROR'
    });
  }
};
