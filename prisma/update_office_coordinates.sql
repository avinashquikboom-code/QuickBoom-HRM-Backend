-- Update office coordinates for Rahul and Avin office
-- Converting 19°06'09.1"N 73°00'31.9"E to decimal format:
-- Latitude: 19°06'09.1"N = 19 + 6/60 + 9.1/3600 = 19.102528
-- Longitude: 73°00'31.9"E = 73 + 0/60 + 31.9/3600 = 73.008861

UPDATE "Office" 
SET 
  "latitude" = 19.102528,
  "longitude" = 73.008861,
  "idealRadiusMeters" = 25.0,
  "maxPunchRadiusMeters" = 50.0,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Rahul and Avin Office' OR "name" LIKE '%Rahul%' OR "name" LIKE '%Avin%' OR "code" = 'RAVI_OFFICE';

-- If office doesn't exist, insert it
INSERT INTO "Office" ("name", "code", "address", "latitude", "longitude", "idealRadiusMeters", "maxPunchRadiusMeters", "isActive", "subscriptionPlan", "billingCycle", "invoiceStatus", "createdAt", "updatedAt")
SELECT 
  'Rahul and Avin Office',
  'RAVI_OFFICE',
  'Rahul and Avin Office Location',
  19.102528,
  73.008861,
  25.0,
  50.0,
  true,
  'Basic',
  'monthly',
  'Paid',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Office" WHERE "name" = 'Rahul and Avin Office' OR "code" = 'RAVI_OFFICE'
);
