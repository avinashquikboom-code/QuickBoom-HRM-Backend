-- ==========================================
-- Create Attendance History Table
-- ==========================================
-- This table will store historical attendance data for reporting and analytics
-- It will complement the existing Attendance table with enhanced historical tracking

-- Create AttendanceHistory table
CREATE TABLE IF NOT EXISTS "AttendanceHistory" (
  id SERIAL PRIMARY KEY,
  employeeId INTEGER NOT NULL,
  officeId INTEGER,
  date VARCHAR(10) NOT NULL, -- Format: YYYY-MM-DD
  
  -- Punch in/out details
  checkIn TIMESTAMP,
  checkOut TIMESTAMP,
  
  -- Attendance status
  status VARCHAR(20) DEFAULT 'ABSENT', -- PRESENT, ABSENT, LATE, HALF_DAY, REMOTE, LEAVE
  
  -- Location data
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Biometric data
  isFingerprintCheckIn BOOLEAN DEFAULT false,
  isFingerprintCheckOut BOOLEAN DEFAULT false,
  
  -- Break tracking
  isOnBreak BOOLEAN DEFAULT false,
  breakStartTime TIMESTAMP,
  totalBreakSeconds INTEGER DEFAULT 0,
  
  -- Work hours calculation
  workingHours INTEGER DEFAULT 0, -- Total working minutes
  overtimeMinutes INTEGER DEFAULT 0, -- Overtime minutes
  
  -- Additional details
  notes TEXT,
  shiftId INTEGER, -- Reference to shift assignment
  
  -- Approval workflow
  isApproved BOOLEAN DEFAULT false,
  approvedBy INTEGER, -- User ID who approved
  approvedAt TIMESTAMP,
  approvalNotes TEXT,
  
  -- Metadata
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign key constraints
  FOREIGN KEY (employeeId) REFERENCES "Employee"(id) ON DELETE CASCADE,
  FOREIGN KEY (officeId) REFERENCES "Office"(id) ON DELETE SET NULL,
  FOREIGN KEY (shiftId) REFERENCES "Shift"(id) ON DELETE SET NULL,
  FOREIGN KEY (approvedBy) REFERENCES "User"(id) ON DELETE SET NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_history_employee_id ON "AttendanceHistory"(employeeId);
CREATE INDEX IF NOT EXISTS idx_attendance_history_date ON "AttendanceHistory"(date);
CREATE INDEX IF NOT EXISTS idx_attendance_history_status ON "AttendanceHistory"(status);
CREATE INDEX IF NOT EXISTS idx_attendance_history_employee_date ON "AttendanceHistory"(employeeId, date);
CREATE INDEX IF NOT EXISTS idx_attendance_history_office_id ON "AttendanceHistory"(officeId);

-- Create unique constraint to prevent duplicate records
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_history_unique 
ON "AttendanceHistory"(employeeId, date);

-- Add trigger to automatically update updatedAt field
CREATE OR REPLACE FUNCTION update_attendance_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updatedAt = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER attendance_history_updated_at
  BEFORE UPDATE ON "AttendanceHistory"
  FOR EACH ROW
  EXECUTE FUNCTION update_attendance_history_updated_at();

-- Insert sample historical data
INSERT INTO "AttendanceHistory" (
  employeeId, officeId, date, checkIn, checkOut, status, 
  latitude, longitude, workingHours, overtimeMinutes, notes,
  isApproved, approvedBy, approvedAt
) 
SELECT 
  e.id as employeeId,
  e.officeId,
  (CURRENT_DATE - INTERVAL '30 days')::date as date,
  (CURRENT_DATE - INTERVAL '30 days')::date + TIME '09:00:00' as checkIn,
  (CURRENT_DATE - INTERVAL '30 days')::date + TIME '18:00:00' as checkOut,
  'PRESENT' as status,
  19.0760 as latitude,
  72.8777 as longitude,
  540 as workingHours, -- 9 hours in minutes
  0 as overtimeMinutes,
  'Regular working day' as notes,
  true as isApproved,
  2 as approvedBy, -- HR user
  CURRENT_TIMESTAMP as approvedAt
FROM "Employee" e 
WHERE e.status = 'active'
LIMIT 2;

-- Insert more sample data for the last 7 days
INSERT INTO "AttendanceHistory" (
  employeeId, officeId, date, checkIn, checkOut, status, 
  workingHours, notes, isApproved, approvedBy
)
SELECT 
  e.id as employeeId,
  e.officeId,
  (CURRENT_DATE - INTERVAL '7 days')::date as date,
  (CURRENT_DATE - INTERVAL '7 days')::date + TIME '09:15:00' as checkIn,
  (CURRENT_DATE - INTERVAL '7 days')::date + TIME '17:30:00' as checkOut,
  'PRESENT' as status,
  495 as workingHours, -- 8.25 hours in minutes
  'Regular working day' as notes,
  true as isApproved,
  2 as approvedBy
FROM "Employee" e 
WHERE e.status = 'active'
LIMIT 3;

-- Verify table creation
SELECT 'AttendanceHistory table created successfully!' as result;

-- Show table structure
\d "AttendanceHistory";

-- Show sample data
SELECT 'Sample AttendanceHistory records:' as info;
SELECT 
  ah.id,
  e."employeeCode",
  e."firstName" || ' ' || e."lastName" as employee_name,
  ah.date,
  ah.checkIn,
  ah.checkOut,
  ah.status,
  ah.workingHours,
  ah.isApproved
FROM "AttendanceHistory" ah
JOIN "Employee" e ON ah.employeeId = e.id
ORDER BY ah.date DESC, e."firstName"
LIMIT 10;
