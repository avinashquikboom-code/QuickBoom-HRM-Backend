-- Seed sample documents for employees
INSERT INTO "Document" (title, type, date, "fileSize", "isPublic", "createdAt", "updatedAt") VALUES
('Employee Handbook 2026', 'policy', '2026-01-01', '8.4 MB', true, NOW(), NOW()),
('IT Asset Policy', 'policy', '2025-06-15', '3.1 MB', true, NOW(), NOW()),
('Code of Conduct', 'policy', '2025-12-01', '2.8 MB', true, NOW(), NOW()),
('Health & Safety Guidelines', 'policy', '2025-11-20', '4.2 MB', true, NOW(), NOW()),
('Remote Work Policy', 'policy', '2025-10-10', '2.5 MB', true, NOW(), NOW()),
('Benefits Guide 2026', 'other', '2026-01-15', '5.7 MB', true, NOW(), NOW()),
('Performance Review Guidelines', 'other', '2025-09-05', '3.9 MB', true, NOW(), NOW()),
('Training Materials 2026', 'other', '2026-02-01', '12.3 MB', true, NOW(), NOW());
