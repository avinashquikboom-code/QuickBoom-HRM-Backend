import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/db';
import leaveBalanceService from './leaveBalanceService';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  employeeId?: number;
  role?: string;
}

class WebSocketService {
  private io: SocketIOServer;
  private connectedUsers: Map<string, AuthenticatedSocket> = new Map();

  constructor(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:8081"],
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as any;
        
        // Get user and employee info
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          include: { employee: true }
        });

        if (!user) {
          return next(new Error('User not found'));
        }

        socket.userId = user.id;
        socket.employeeId = user.employee?.id;
        socket.role = user.role;
        
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      console.log(`🔗 User connected: ${socket.userId} (${socket.role})`);
      
      // Store connected user
      this.connectedUsers.set(socket.id, socket);

      // Join user-specific room
      if (socket.userId) {
        socket.join(`user_${socket.userId}`);
      }

      // Join role-specific room
      if (socket.role) {
        socket.join(`role_${socket.role}`);
      }

      // Join employee-specific room
      if (socket.employeeId) {
        socket.join(`employee_${socket.employeeId}`);
      }

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.userId}`);
        this.connectedUsers.delete(socket.id);
      });

      // Handle real-time data requests
      socket.on('requestRealTimeData', async (data) => {
        try {
          const { type } = data;
          
          switch (type) {
            case 'attendance':
              await this.sendRealTimeAttendance(socket);
              break;
            case 'notifications':
              await this.sendRealTimeNotifications(socket);
              break;
            case 'leaves':
              await this.sendRealTimeLeaves(socket);
              break;
            case 'dashboard':
              await this.sendRealTimeDashboard(socket);
              break;
            case 'leaveBalance':
              await this.sendRealTimeLeaveBalance(socket);
              break;
            default:
              socket.emit('error', 'Unknown data type requested');
          }
        } catch (error) {
          socket.emit('error', 'Failed to fetch real-time data');
        }
      });
    });
  }

  // Real-time attendance updates
  async broadcastAttendanceUpdate(employeeId: number, data: any): Promise<void> {
    this.io.to(`employee_${employeeId}`).emit('attendanceUpdate', data);
    this.io.to('role_HR').emit('attendanceUpdate', data);
    this.io.to('role_ADMIN').emit('attendanceUpdate', data);
  }

  // Real-time notification updates
  async broadcastNotification(employeeId: number, notification: any): Promise<void> {
    this.io.to(`employee_${employeeId}`).emit('newNotification', notification);
  }

  // Real-time leave updates
  async broadcastLeaveUpdate(employeeId: number, data: any): Promise<void> {
    this.io.to(`employee_${employeeId}`).emit('leaveUpdate', data);
    this.io.to('role_HR').emit('leaveUpdate', data);
  }

  // Real-time dashboard updates
  async broadcastDashboardUpdate(role: string, data: any): Promise<void> {
    this.io.to(`role_${role}`).emit('dashboardUpdate', data);
  }

  // Broadcast to specific role
  async broadcastToRole(role: string, data: any): Promise<void> {
    this.io.to(`role_${role}`).emit('newNotification', data);
  }

  // Real-time leave balance updates
  async broadcastLeaveBalanceUpdate(employeeId: number, data: any): Promise<void> {
    this.io.to(`employee_${employeeId}`).emit('leaveBalanceUpdate', data);
    this.io.to('role_HR').emit('leaveBalanceUpdate', data);
    this.io.to('role_ADMIN').emit('leaveBalanceUpdate', data);
  }

  // Send real-time data to specific socket
  private async sendRealTimeAttendance(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.employeeId) return;

    const todayAttendance = await prisma.attendance.findFirst({
      where: {
        employeeId: socket.employeeId,
        date: new Date().toISOString().split('T')[0]
      }
    });

    socket.emit('attendanceData', todayAttendance);
  }

  private async sendRealTimeNotifications(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.userId) return;

    const notifications = await prisma.notification.findMany({
      where: { userId: socket.userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    socket.emit('notificationsData', notifications);
  }

  private async sendRealTimeLeaves(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.employeeId) return;

    const leaves = await prisma.leaveRequest.findMany({
      where: { employeeId: socket.employeeId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    socket.emit('leavesData', leaves);
  }

  private async sendRealTimeDashboard(socket: AuthenticatedSocket): Promise<void> {
    // Send role-specific dashboard data
    if (socket.role === 'EMPLOYEE' && socket.employeeId) {
      const employeeStats = await this.getEmployeeDashboardStats(socket.employeeId);
      socket.emit('dashboardData', employeeStats);
    } else if (socket.role === 'HR' || socket.role === 'ADMIN') {
      const hrStats = await this.getHRDashboardStats();
      socket.emit('dashboardData', hrStats);
    }
  }

  private async sendRealTimeLeaveBalance(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.employeeId) return;

    try {
      const leaveBalance = await leaveBalanceService.getEmployeeLeaveBalance(socket.employeeId);
      socket.emit('leaveBalanceData', leaveBalance);
    } catch (error) {
      console.error('Error sending real-time leave balance:', error);
      socket.emit('error', 'Failed to fetch leave balance');
    }
  }

  private async getEmployeeDashboardStats(employeeId: number): Promise<any> {
    // Get employee-specific dashboard stats
    const attendance = await prisma.attendance.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
      take: 7
    });

    const leaves = await prisma.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    return {
      attendance: attendance,
      leaves: leaves,
      totalAttendance: attendance.length,
      presentToday: attendance.some(a => a.date === new Date().toISOString().split('T')[0] && a.checkIn)
    };
  }

  private async getHRDashboardStats(): Promise<any> {
    // Get HR dashboard stats
    const totalEmployees = await prisma.employee.count();
    const presentToday = await prisma.attendance.count({
      where: {
        date: new Date().toISOString().split('T')[0],
        checkIn: { not: null }
      }
    });

    const pendingLeaves = await prisma.leaveRequest.count({
      where: { status: 'PENDING' }
    });

    return {
      totalEmployees,
      presentToday,
      pendingLeaves,
      attendanceRate: totalEmployees > 0 ? (presentToday / totalEmployees) * 100 : 0
    };
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  // Get server instance
  getServer(): SocketIOServer {
    return this.io;
  }
}

export default WebSocketService;
