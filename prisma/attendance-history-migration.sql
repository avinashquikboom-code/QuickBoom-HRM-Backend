-- Attendance History Table Migration
-- This will be executed via Prisma migrate

-- Create AttendanceHistory table
CREATE TABLE "AttendanceHistory" (
  id SERIAL PRIMARY KEY,
  "employeeId" INTEGER NOT NULL,
  "officeId" INTEGER,
  "date" VARCHAR(10) NOT NULL,
  
  "checkIn" TIMESTAMP,
  "checkOut" TIMESTAMP,
  "status" VARCHAR(20) DEFAULT 'ABSENT',
  
  "latitude" DECIMAL(10, 8),
  "longitude" DECIMAL(11, 8),
  
  "isFingerprintCheckIn" BOOLEAN DEFAULT false,
  "isFingerprintCheckOut" BOOLEAN DEFAULT false,
  
  "isOnBreak" BOOLEAN DEFAULT false,
  "breakStartTime" TIMESTAMP,
  "totalBreakSeconds" INTEGER DEFAULT 0,
  
  "workingHours" INTEGER DEFAULT 0,
  "overtimeMinutes" INTEGER DEFAULT 0,
  
  "notes" TEXT,
  "shiftId" INTEGER,
  
  "isApproved" BOOLEAN DEFAULT false,
  "approvedBy" INTEGER,
  "approvedAt" TIMESTAMP,
  "approvalNotes" TEXT,
  
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE CASCADE,
  FOREIGN KEY ("officeId") REFERENCES "Office"(id) ON DELETE SET NULL,
  FOREIGN KEY ("shiftId") REFERENCES "Shift"(id) ON DELETE SET NULL,
  FOREIGN KEY ("approvedBy") REFERENCES "User"(id) ON DELETE NULL
);

CREATE INDEX "idx_attendance_history_employee_id" ON "AttendanceHistory"("employeeId");
CREATE INDEX "idx_attendance_history_date" ON "AttendanceHistory"("date");
CREATE INDEX "idx_attendance_history_status" ON "AttendanceHistory"("status");
CREATE UNIQUE INDEX "idx_attendance_history_unique" ON "AttendanceHistory"("employeeId", "date");
