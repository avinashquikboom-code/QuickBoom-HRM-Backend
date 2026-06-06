-- Create a default office
INSERT INTO "Office" (
  name, 
  code, 
  address, 
  "latitude", 
  "longitude", 
  "idealRadiusMeters", 
  "maxPunchRadiusMeters",
  "createdAt", 
  "updatedAt"
) VALUES (
  'Main Office', 
  'MAIN', 
  '123 Business Ave, Mumbai, India', 
  19.102528, 
  73.008861, 
  25.0, 
  50.0,
  NOW(), 
  NOW()
) RETURNING id;

-- Assign the office to the employee
UPDATE "Employee" 
SET "officeId" = 1 
WHERE "employeeCode" = 'EMP001';
