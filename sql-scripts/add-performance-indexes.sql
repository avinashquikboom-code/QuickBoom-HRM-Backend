-- Performance Optimization Indexes for QuickBoom HRM
-- Run this script on your production database (Supabase/Hostinger)
-- This will significantly improve query performance for frequently accessed fields

-- Attendance Table Indexes
-- These indexes optimize the most common attendance queries
CREATE INDEX IF NOT EXISTS idx_attendance_date ON "Attendance"(date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON "Attendance"("employeeId");
CREATE INDEX IF NOT EXISTS idx_attendance_status ON "Attendance"(status);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON "Attendance"("employeeId", date);

-- LeaveRequest Table Indexes
-- These optimize leave approval workflows and employee leave queries
CREATE INDEX IF NOT EXISTS idx_leave_request_employee_id ON "LeaveRequest"("employeeId");
CREATE INDEX IF NOT EXISTS idx_leave_request_status ON "LeaveRequest"(status);
CREATE INDEX IF NOT EXISTS idx_leave_request_from_date ON "LeaveRequest"("fromDate");
CREATE INDEX IF NOT EXISTS idx_leave_request_employee_status ON "LeaveRequest"("employeeId", status);

-- Expense Table Indexes
-- These optimize expense approval workflows
CREATE INDEX IF NOT EXISTS idx_expense_employee_id ON "Expense"("employeeId");
CREATE INDEX IF NOT EXISTS idx_expense_status ON "Expense"(status);
CREATE INDEX IF NOT EXISTS idx_expense_date ON "Expense"(date);
CREATE INDEX IF NOT EXISTS idx_expense_employee_status ON "Expense"("employeeId", status);

-- Employee Table Indexes
-- These optimize employee filtering by office, department, and status
CREATE INDEX IF NOT EXISTS idx_employee_office_id ON "Employee"("officeId");
CREATE INDEX IF NOT EXISTS idx_employee_department_id ON "Employee"("departmentId");
CREATE INDEX IF NOT EXISTS idx_employee_status ON "Employee"(status);

-- Notification Table Indexes
-- These optimize notification queries for users and read status
CREATE INDEX IF NOT EXISTS idx_notification_employee_id ON "Notification"("employeeId");
CREATE INDEX IF NOT EXISTS idx_notification_user_id ON "Notification"("userId");
CREATE INDEX IF NOT EXISTS idx_notification_is_read ON "Notification"("isRead");
CREATE INDEX IF NOT EXISTS idx_notification_created_at ON "Notification"("createdAt");

-- Verify indexes were created
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('Attendance', 'LeaveRequest', 'Expense', 'Employee', 'Notification')
ORDER BY tablename, indexname;
