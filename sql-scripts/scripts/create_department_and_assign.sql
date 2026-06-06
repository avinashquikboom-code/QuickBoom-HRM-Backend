-- Create a default department
INSERT INTO "Department" (
  name, 
  code, 
  "createdAt", 
  "updatedAt"
) VALUES (
  'Engineering', 
  'ENG', 
  NOW(), 
  NOW()
) RETURNING id;

-- Assign the department to the employee
UPDATE "Employee" 
SET "departmentId" = 1 
WHERE "employeeCode" = 'EMP001';
