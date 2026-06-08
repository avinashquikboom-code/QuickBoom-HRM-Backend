# QuickBoom HRM API Documentation

This document provides comprehensive information about the QuickBoom HR Management System API endpoints, authentication, and usage guidelines.

## 📖 Documentation Access

### Interactive Documentation
- **Swagger UI**: http://localhost:5003/api-docs
- **Scalar Documentation**: http://localhost:5003/scalar-docs

### Production Documentation
- **Swagger UI**: https://quickboom-backend.onrender.com/api-docs
- **Scalar Documentation**: https://quickboom-backend.onrender.com/scalar-docs

## 🔐 Authentication

The API uses JWT (JSON Web Token) authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Login Endpoint
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

## 📋 API Endpoints Overview

### Health Monitoring (`/health`)
- `GET /` - Basic health check
- `GET /detailed` - Comprehensive health check with all services and system metrics
- `GET /database` - Database health check
- `GET /metrics` - System and application metrics
- `GET /ready` - Readiness probe for container orchestration
- `GET /live` - Liveness probe for container orchestration

### Authentication (`/api/auth`)
- `POST /login` - User login
- `POST /register` - Register new user (Admin only)
- `POST /fcm-token` - Register FCM token for push notifications

### Admin Panel (`/api/admin`)
#### Users Management
- `GET /users` - Fetch all platform users (Super Admin only)
- `PUT /users/:id/status` - Update user status

#### Employees Management
- `GET /employees` - Fetch all employees
- `POST /employees` - Create new employee
- `POST /employees/assign` - Create and assign employee to office

#### Offices Management
- `GET /offices` - Fetch all offices
- `GET /offices/:id` - Fetch office by ID
- `POST /offices` - Create new office
- `PUT /offices/:id` - Update office
- `DELETE /offices/:id` - Delete office
- `PUT /offices/assign-employee/:employeeId` - Assign employee to office

#### Attendance Management
- `GET /attendance/today` - Fetch today's attendance
- `GET /attendance/history` - Fetch attendance history

#### Leave Management
- `GET /leaves` - Fetch all leave requests
- `GET /leaves/balances` - Fetch leave balances
- `POST /leaves` - Create leave request
- `PUT /leaves/:id` - Update leave status

#### Payroll Management
- `GET /payroll/stats` - Fetch payroll statistics
- `GET /payroll/runs` - Fetch payroll runs
- `POST /payroll/disburse` - Execute payroll disbursement
- `GET /payroll/slips` - Fetch salary slips
- `POST /payroll/slips/approve` - Approve salary slip

#### Analytics & Reports
- `GET /analytics/overview` - Fetch analytics overview
- `GET /reports` - Fetch admin reports
- `POST /reports/generate` - Generate new report
- `GET /reports/payroll-details` - Fetch payroll report details
- `GET /reports/attendance-details` - Fetch attendance report details

#### Notifications
- `GET /notifications` - Fetch admin notifications
- `PUT /notifications/:id/read` - Mark notification as read
- `PUT /notifications/read-all` - Mark all notifications as read

#### Settings
- `GET /settings` - Fetch admin settings
- `PUT /settings` - Update admin settings

#### Profile Management
- `GET /profile` - Fetch admin profile
- `PUT /profile` - Update admin profile
- `POST /profile/avatar` - Upload profile avatar
- `DELETE /profile/avatar` - Remove profile avatar

### Employee Portal (`/api/employee`)
#### Dashboard
- `GET /dashboard/stats` - Fetch employee dashboard statistics

#### Profile Management
- `GET /profile` - Fetch employee profile
- `PUT /profile` - Update employee profile
- `POST /profile/avatar` - Upload profile avatar
- `DELETE /profile/avatar` - Remove profile avatar

#### Attendance Tracking
- `GET /attendance/today` - Fetch today's attendance
- `GET /attendance/history` - Fetch attendance history
- `POST /attendance/check-in` - Check in for work
- `POST /attendance/check-out` - Check out from work
- `POST /attendance/break/start` - Start break
- `POST /attendance/break/end` - End break

#### Leave Management
- `GET /leaves` - Fetch leaves and balances
- `POST /leaves` - Apply for leave

#### Shift Management
- `GET /shifts` - Fetch employee shift timings

#### Expense Management
- `GET /expenses` - Fetch employee expenses
- `POST /expenses` - Create new expense claim

#### Task Management
- `GET /tasks` - Fetch employee tasks
- `PUT /tasks/:id` - Update task status

#### Notifications
- `GET /notifications` - Fetch employee notifications
- `PUT /notifications/:id/read` - Mark notification as read
- `PUT /notifications/read-all` - Mark all notifications as read

### HR Management (`/api/hr`)
#### Dashboard
- `GET /stats` - Fetch HR dashboard statistics
- `GET /departments` - Fetch department overview
- `GET /leaves` - Fetch leave overview
- `GET /attendance-trend` - Fetch attendance trend
- `GET /activity` - Fetch HR activity

#### Employee Management
- `GET /employees` - Fetch all employees for HR management

#### Expense Review
- `GET /expenses` - Fetch expense claims for review
- `POST /expenses/:id/approve` - Approve expense claim
- `POST /expenses/:id/reject` - Reject expense claim

#### Leave Review
- `POST /leaves/:id/approve` - Approve leave request
- `POST /leaves/:id/reject` - Reject leave request

#### Task Management
- `GET /tasks` - Fetch HR tasks
- `POST /tasks` - Create new HR task

#### Payroll Management
- `GET /payroll/stats` - Fetch payroll statistics
- `GET /payroll/runs` - Fetch payroll runs

## 🎭 User Roles

The API supports the following user roles:

### SUPER_ADMIN
- Full system access
- Manage all companies and users
- Platform-level operations

### ADMIN
- Company-level administration
- Manage employees, offices, and operations

### HR
- HR operations and employee management
- Leave and expense approvals
- Payroll access

### EMPLOYEE
- Personal profile and attendance management
- Leave applications and expense claims
- Task management

### PLATFORM_ADMIN
- Platform configuration and settings
- Subscription management

## 📊 Data Models

### User
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "EMPLOYEE|HR|ADMIN|SUPER_ADMIN|PLATFORM_ADMIN",
  "status": "ACTIVE|INACTIVE|SUSPENDED",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### Employee
```json
{
  "id": "uuid",
  "userId": "uuid",
  "employeeId": "EMP001",
  "department": "Engineering",
  "position": "Software Developer",
  "joinDate": "2024-01-01",
  "salary": 75000,
  "officeId": "uuid",
  "status": "ACTIVE|INACTIVE|ON_LEAVE",
  "user": { "User" }
}
```

### Office
```json
{
  "id": "uuid",
  "name": "Main Office",
  "address": "123 Main St, City, Country",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "radius": 100,
  "timezone": "America/New_York",
  "workingHours": {
    "start": "09:00",
    "end": "18:00"
  }
}
```

### Attendance
```json
{
  "id": "uuid",
  "employeeId": "uuid",
  "date": "2024-01-01",
  "checkIn": "2024-01-01T09:00:00Z",
  "checkOut": "2024-01-01T18:00:00Z",
  "breakStart": "2024-01-01T13:00:00Z",
  "breakEnd": "2024-01-01T14:00:00Z",
  "totalHours": 8,
  "status": "PRESENT|ABSENT|LATE|HALF_DAY|ON_LEAVE",
  "location": {
    "latitude": 40.7128,
    "longitude": -74.0060
  }
}
```

### Leave
```json
{
  "id": "uuid",
  "employeeId": "uuid",
  "type": "SICK|CASUAL|ANNUAL|MATERNITY|PATERNITY|UNPAID",
  "startDate": "2024-01-01",
  "endDate": "2024-01-02",
  "reason": "Medical appointment",
  "status": "PENDING|APPROVED|REJECTED",
  "approvedBy": "uuid",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Payroll
```json
{
  "id": "uuid",
  "employeeId": "uuid",
  "month": "January",
  "year": 2024,
  "basicSalary": 75000,
  "allowances": 5000,
  "deductions": 8000,
  "netSalary": 72000,
  "status": "PENDING|PROCESSED|PAID",
  "processedDate": "2024-01-31T00:00:00Z"
}
```

### Notification
```json
{
  "id": "uuid",
  "userId": "uuid",
  "title": "Leave Request Approved",
  "message": "Your leave request has been approved",
  "type": "INFO|WARNING|ERROR|SUCCESS|LEAVE|PAYROLL|ATTENDANCE",
  "isRead": false,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Expense
```json
{
  "id": "uuid",
  "employeeId": "uuid",
  "title": "Business Lunch",
  "description": "Client meeting lunch",
  "amount": 150.50,
  "category": "TRAVEL|MEAL|ACCOMMODATION|OFFICE|MEDICAL|OTHER",
  "status": "PENDING|APPROVED|REJECTED",
  "receiptUrl": "https://example.com/receipt.jpg",
  "submittedDate": "2024-01-01"
}
```

### Health Status
```json
{
  "status": "healthy|unhealthy|degraded",
  "timestamp": "2024-01-01T00:00:00Z",
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "development",
  "services": [
    {
      "name": "database",
      "status": "healthy",
      "responseTime": 50,
      "details": {
        "connection": "connected",
        "userCount": 150,
        "employeeCount": 120
      }
    }
  ],
  "system": {
    "platform": "darwin",
    "arch": "x64",
    "nodeVersion": "v18.17.0",
    "memory": {
      "total": 8589934592,
      "free": 4294967296,
      "used": 4294967296,
      "percentage": 50
    },
    "cpu": {
      "cores": 8,
      "loadAverage": [1.5, 1.2, 1.0],
      "percentage": 25
    }
  },
  "metrics": {
    "activeConnections": 10,
    "requestsPerMinute": 45,
    "errorRate": 2.5,
    "averageResponseTime": 120
  }
}
```

### Service Health
```json
{
  "name": "database",
  "status": "healthy|unhealthy|degraded",
  "responseTime": 50,
  "error": "Connection failed",
  "details": {
    "connection": "connected",
    "lastCheck": "2024-01-01T00:00:00Z"
  }
}
```

## 🔧 Error Handling

The API uses standard HTTP status codes and returns error responses in the following format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information"
}
```

### Common Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

## 🌍 Environment Variables

Create a `.env` file in the root directory:

```env
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://username:password@localhost:5432/database
JWT_SECRET=your-jwt-secret-key
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
FIREBASE_SERVICE_ACCOUNT_JSON=your-firebase-service-account-json
```

## 🚀 Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Generate Prisma client**
   ```bash
   npx prisma generate
   ```

4. **Run database migrations**
   ```bash
   npx prisma migrate dev
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Access API documentation**
   - Swagger UI: http://localhost:5003/api-docs
   - Scalar Documentation: http://localhost:5003/scalar-docs

## 📝 Development

### Adding New Endpoints

1. Create the controller function in `src/controllers/`
2. Add the route in `src/routes/`
3. Add Swagger documentation comments above the route
4. Update the OpenAPI schema if needed

### Swagger Documentation Format

```javascript
/**
 * @swagger
 * /api/endpoint:
 *   method:
 *     summary: Brief description
 *     tags: [Category]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SchemaName'
 *     responses:
 *       200:
 *         description: Success description
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResponseSchema'
 */
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Update documentation
6. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions:
- Email: support@quickboom.com
- Documentation: Available at `/api-docs` and `/scalar-docs`
- Issues: Create an issue in the repository
