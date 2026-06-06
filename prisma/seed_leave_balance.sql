-- ==========================================
-- Seed Leave Balance Data for All Employees
-- ==========================================

-- This script creates leave balance records for all employees
-- Based on the LeaveBalance schema:
-- id, employeeId (unique), fiscalYear, casualTotal, casualUsed, sickTotal, sickUsed, earnedTotal, earnedUsed, createdBy, createdAt, updatedAt

-- First, let's see what employees we have
SELECT 'Current employees:' as info;
SELECT id, employeeCode, firstName, lastName, designation, status FROM Employee LIMIT 10;

-- Create leave balance records for all employees who don't have one yet
INSERT INTO "LeaveBalance" (
  "employeeId", 
  "fiscalYear", 
  "casualTotal", 
  "casualUsed", 
  "sickTotal", 
  "sickUsed", 
  "earnedTotal", 
  "earnedUsed", 
  "createdBy", 
  "createdAt", 
  "updatedAt"
)
SELECT 
  e.id as "employeeId",
  '2026' as "fiscalYear",
  CASE 
    WHEN e.status = 'active' THEN 12
    ELSE 6
  END as "casualTotal",
  CASE 
    WHEN e.status = 'active' THEN FLOOR(RANDOM() * 3) -- 0-2 casual leaves used for active employees
    ELSE 0
  END as "casualUsed",
  CASE 
    WHEN e.status = 'active' THEN 10
    ELSE 5
  END as "sickTotal",
  CASE 
    WHEN e.status = 'active' THEN FLOOR(RANDOM() * 2) -- 0-1 sick leaves used for active employees
    ELSE 0
  END as "sickUsed",
  CASE 
    WHEN e.status = 'active' THEN 15
    ELSE 8
  END as "earnedTotal",
  CASE 
    WHEN e.status = 'active' THEN FLOOR(RANDOM() * 5) -- 0-4 earned leaves used for active employees
    ELSE 0
  END as "earnedUsed",
  'system' as "createdBy",
  NOW() as "createdAt",
  NOW() as "updatedAt"
FROM "Employee" e
WHERE e.id NOT IN (
  SELECT lb."employeeId" 
  FROM "LeaveBalance" lb 
  WHERE lb."fiscalYear" = '2026'
);

-- Show the results
SELECT 'Leave balances created:' as info;
SELECT 
  lb."employeeId",
  e."employeeCode",
  e."firstName" || ' ' || e."lastName" as "employeeName",
  e."status",
  lb."casualTotal",
  lb."casualUsed",
  lb."sickTotal", 
  lb."sickUsed",
  lb."earnedTotal",
  lb."earnedUsed",
  (lb."casualTotal" - lb."casualUsed") as "casualRemaining",
  (lb."sickTotal" - lb."sickUsed") as "sickRemaining", 
  (lb."earnedTotal" - lb."earnedUsed") as "earnedRemaining"
FROM "LeaveBalance" lb
JOIN "Employee" e ON lb."employeeId" = e.id
WHERE lb."fiscalYear" = '2026'
ORDER BY e."firstName", e."lastName";

-- Summary statistics
SELECT 'Summary statistics:' as info;
SELECT 
  COUNT(*) as "totalEmployeesWithLeaveBalance",
  COUNT(CASE WHEN e.status = 'active' THEN 1 END) as "activeEmployees",
  COUNT(CASE WHEN e.status != 'active' THEN 1 END) as "inactiveEmployees",
  SUM(lb."casualTotal") as "totalCasualLeaves",
  SUM(lb."casualUsed") as "totalCasualUsed",
  SUM(lb."sickTotal") as "totalSickLeaves", 
  SUM(lb."sickUsed") as "totalSickUsed",
  SUM(lb."earnedTotal") as "totalEarnedLeaves",
  SUM(lb."earnedUsed") as "totalEarnedUsed"
FROM "LeaveBalance" lb
JOIN "Employee" e ON lb."employeeId" = e.id
WHERE lb."fiscalYear" = '2026';
