-- Check employee and office assignment
SELECT 
  u.id as user_id,
  u.email,
  u.role,
  e.id as employee_id,
  e."employeeCode",
  e."firstName",
  e."lastName",
  e."officeId",
  o.id as office_exists,
  o.name as office_name
FROM "User" u
LEFT JOIN "Employee" e ON u.id = e."userId"
LEFT JOIN "Office" o ON e."officeId" = o.id
WHERE u.email = 'employee@hrm.com';
