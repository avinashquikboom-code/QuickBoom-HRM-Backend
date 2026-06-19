# QuickBoom HRM Backend

A comprehensive HR Management System backend built with Node.js, Express, TypeScript, and Prisma ORM.

## Features

- **Authentication & Authorization**: JWT-based auth with role-based access control (SUPER_ADMIN, ADMIN, HR, EMPLOYEE, PLATFORM_ADMIN)
- **Employee Management**: Create, update, and manage employee profiles
- **Attendance Tracking**: Check-in/check-out with geofencing and location tracking
- **Leave Management**: Apply, approve, and manage leave requests
- **Payroll System**: Generate salary slips and manage payroll runs
- **Shift Management**: Create and assign shifts to employees
- **Notifications**: Firebase Cloud Messaging (FCM) for push notifications
- **Reports**: Comprehensive attendance, payroll, and HR reports
- **Real-time Updates**: WebSocket support for live data updates
- **API Documentation**: Scalar API documentation at `/scalar-docs`

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Authentication**: JWT (jsonwebtoken)
- **Password Hashing**: bcrypt
- **PDF Generation**: pdfmake
- **Notifications**: Firebase Admin SDK
- **Real-time**: WebSocket (ws)
- **API Documentation**: Scalar (swagger-jsdoc)

## Prerequisites

- Node.js >= 18.x
- PostgreSQL >= 14.x
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd quickboom-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your database credentials and other settings.

5. Run database migrations:
```bash
npx prisma migrate dev
```

6. Generate Prisma client:
```bash
npx prisma generate
```

## Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/quickboom_hrm"

# JWT
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# Server
PORT=3000
HOST=0.0.0.0

# Firebase (for notifications)
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_PRIVATE_KEY="your-private-key"
FIREBASE_CLIENT_EMAIL="your-client-email"

# CORS
CORS_ORIGIN="http://localhost:3000"
```

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The server will start on `http://localhost:3000` (or the port specified in your `.env`).

## API Documentation

Once the server is running, access the Scalar API documentation at:
- **Local**: http://localhost:3000/scalar-docs
- **Production**: http://69.62.80.20:3000/scalar-docs

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - User logout

### Mobile Auth
- `POST /api/mobile/auth/login` - Mobile user login
- `POST /api/mobile/auth/refresh` - Refresh mobile token
- `POST /api/mobile/auth/forgot-password` - Forgot password
- `PUT /api/mobile/auth/change-password` - Change password
- `GET /api/mobile/auth/profile` - Get user profile

### Admin Routes
- `GET /api/admin/dashboard` - Dashboard stats
- `GET /api/admin/employees` - Fetch employees
- `POST /api/admin/employees` - Create employee
- `PUT /api/admin/users/:userId/reset-password` - Reset employee password
- `PUT /api/admin/change-password` - Change own password
- `GET /api/admin/shifts` - Fetch shifts
- `POST /api/admin/shifts` - Create shift
- `PUT /api/admin/shifts/:id` - Update shift
- `DELETE /api/admin/shifts/:id` - Delete shift
- `POST /api/admin/shifts/assign` - Assign shift to employee
- `GET /api/admin/notifications` - Fetch notifications
- `POST /api/admin/notifications/send-department` - Send to department
- `POST /api/admin/notifications/send-role` - Send to role
- `GET /api/admin/settings` - Fetch settings
- `PUT /api/admin/settings` - Update settings

### Mobile Routes
- `GET /api/mobile/attendance/today` - Today's attendance
- `POST /api/mobile/attendance/check-in` - Check in
- `POST /api/mobile/attendance/check-out` - Check out
- `GET /api/mobile/leave/balances` - Leave balances
- `POST /api/mobile/leave/apply` - Apply for leave
- `GET /api/mobile/payroll/slips` - Salary slips
- `GET /api/mobile/notifications` - Notifications

## Database Schema

The application uses Prisma ORM with the following main models:
- User
- Profile
- Employee
- Office
- Department
- Attendance
- Leave
- LeaveBalance
- Shift
- ShiftAssignment
- Payslip
- Notification
- Expense

## WebSocket Support

The backend includes WebSocket support for real-time updates. The WebSocket server runs on the same port as the HTTP server.

## Docker Support

### Build Docker Image
```bash
docker build -t quickboom-backend .
```

### Run with Docker Compose
```bash
docker-compose up
```

## Project Structure

```
src/
├── config/           # Configuration files
├── controllers/      # Route controllers
│   ├── adminController.ts
│   ├── mobile/
│   └── payrollController.ts
├── middlewares/      # Express middlewares
├── routes/          # API routes
│   ├── adminRoutes.ts
│   └── mobile/
├── services/        # Business logic services
├── utils/           # Utility functions
└── index.ts         # Application entry point
```

## Development Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Run database migrations
- `npx prisma generate` - Generate Prisma client

## Troubleshooting

### Database Connection Issues
Ensure PostgreSQL is running and the `DATABASE_URL` in `.env` is correct.

### Prisma Client Issues
Run `npx prisma generate` after installing new dependencies.

### Port Already in Use
Change the `PORT` in `.env` or stop the process using the port.

## License

MIT

## Support

For support, email support@quickboom.com
