-- Check office data to verify geofence coordinates
SELECT id, name, code, "latitude", "longitude", "idealRadiusMeters", "maxPunchRadiusMeters", "isActive" 
FROM "Office" 
WHERE name LIKE '%koparkherne%' OR name LIKE '%Rahul%' OR name LIKE '%Avin%' OR code = 'RAVI_OFFICE' OR id = 1 
ORDER BY id 
LIMIT 5;
