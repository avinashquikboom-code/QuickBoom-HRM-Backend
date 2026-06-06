-- Check existing offices
SELECT 
  id,
  name,
  code,
  "latitude",
  "longitude",
  "idealRadiusMeters",
  "maxPunchRadiusMeters"
FROM "Office"
ORDER BY id;
