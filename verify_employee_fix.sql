-- Verify employee office assignment
SELECT 
  u.email,
  u.role,
  e."employeeCode",
  e."firstName",
  e."lastName",
  e."officeId",
  o.name as office_name,
  o.code as office_code
FROM "User" u
LEFT JOIN "Employee" e ON u.id = e."userId"
LEFT JOIN "Office" o ON e."officeId" = o.id
WHERE u.email = 'employee@hrm.com';
