import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import path from 'path';
import fs from 'fs';

const router = Router();

// Public route to download expense receipt PDFs (no auth required)
router.get('/receipts/:filename', (req, res) => {
  const filename = req.params.filename as string;

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    res.status(403).json({ success: false, message: 'Invalid file name' });
    return;
  }

  const filePath = path.join(process.cwd(), 'uploads', 'receipts', filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ success: false, message: 'Receipt not found' });
    return;
  }

  const lower = filename.toLowerCase();
  let contentType = 'application/pdf';
  if (lower.endsWith('.png')) contentType = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (lower.endsWith('.webp')) contentType = 'image/webp';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

export default router;
