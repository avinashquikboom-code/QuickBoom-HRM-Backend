-- Fix admin email mismatch: update user email from admin@hr.com to admin@hrm.com
-- This fixes the login issue where user was trying to login with admin@hrm.com
-- but the database had admin@hr.com

UPDATE "User" SET email = 'admin@hrm.com' WHERE email = 'admin@hr.com';
UPDATE "Profile" SET email = 'admin@hrm.com' WHERE email = 'admin@hrm.com';

-- Verify the update
SELECT id, email, role, "isActive" FROM "User" WHERE email = 'admin@hrm.com';
