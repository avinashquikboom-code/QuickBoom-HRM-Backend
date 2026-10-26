import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../utils/db';
import { expenseReceiptService } from '../services/expenseReceiptService';

const router = Router();

// Candidate base directories to look for uploads
function getCandidateFilePaths(filename: string): string[] {
  return [
    path.join(process.cwd(), 'uploads', 'receipts', filename),
    path.resolve(__dirname, '..', '..', 'uploads', 'receipts', filename),
    path.resolve(__dirname, '..', 'uploads', 'receipts', filename),
    path.join(process.cwd(), 'dist', 'uploads', 'receipts', filename),
  ];
}

function getCandidateCampaignPaths(filename: string): string[] {
  return [
    path.join(process.cwd(), 'uploads', 'campaigns', filename),
    path.resolve(__dirname, '..', '..', 'uploads', 'campaigns', filename),
    path.resolve(__dirname, '..', 'uploads', 'campaigns', filename),
    path.join(process.cwd(), 'dist', 'uploads', 'campaigns', filename),
  ];
}

// Public route to download/view expense receipt PDFs (no auth required)
router.get('/receipts/:filename', async (req, res) => {
  const filename = req.params.filename as string;

  console.log(`\n📥 [Receipt Download Request] Filename: "${filename}"`);

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    console.warn(`⚠️ [Receipt Download] Invalid filename requested: "${filename}"`);
    res.status(403).json({ success: false, message: 'Invalid file name' });
    return;
  }

  // 1. Check disk candidates
  const candidates = getCandidateFilePaths(filename);
  let existingFilePath: string | null = null;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      existingFilePath = candidate;
      break;
    }
  }

  if (existingFilePath) {
    console.log(`✅ [Receipt Download] Found file on disk at: "${existingFilePath}"`);
    const lower = filename.toLowerCase();
    let contentType = 'application/pdf';
    if (lower.endsWith('.png')) contentType = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lower.endsWith('.webp')) contentType = 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    
    const stream = fs.createReadStream(existingFilePath);
    stream.pipe(res);
    return;
  }

  console.warn(`⚠️ [Receipt Download] File not found on disk across candidate paths for: "${filename}". Attempting DB lookup & dynamic re-generation...`);

  // 2. Extract expense ID from filename or database query
  try {
    let expenseId: number | null = null;

    // Pattern 1: expenseclaimreceipt_{id}_{timestamp}.pdf or receipt_{id}_{timestamp}.pdf
    const match = filename.match(/expenseclaimreceipt_(\d+)_\d+\.pdf/i) ||
                  filename.match(/receipt_(\d+)_\d+\./i);
    
    if (match) {
      expenseId = parseInt(match[1], 10);
    }

    let expense: any = null;
    if (expenseId && !isNaN(expenseId)) {
      expense = await prisma.expense.findUnique({
        where: { id: expenseId },
        include: {
          employee: {
            include: { department: true, office: true, store: true },
          },
        },
      });
    }

    if (!expense) {
      // Pattern 2: Search DB by receiptUrl or receiptPdfUrl containing filename
      expense = await prisma.expense.findFirst({
        where: {
          OR: [
            { receiptPdfUrl: { contains: filename } },
            { receiptUrl: { contains: filename } },
          ],
        },
        include: {
          employee: {
            include: { department: true, office: true, store: true },
          },
        },
      });
    }

    if (expense) {
      console.log(`✅ [Receipt Download] Found matching Expense claim #${expense.id} in DB! Dynamically generating receipt PDF...`);

      const reviewDetails = {
        reviewedBy: expense.reviewedBy || 'HR Administration',
        reviewNote: expense.reviewNote || (expense.status === 'APPROVED' ? 'Approved for reimbursement' : 'Expense Record'),
        reviewedAt: expense.updatedAt || new Date(),
      };

      const { pdfBuffer } = await expenseReceiptService.generateExpenseReceipt(
        expense,
        expense.employee,
        reviewDetails
      );

      // Save generated PDF to primary disk path for future requests
      try {
        const primaryPath = candidates[0];
        const dir = path.dirname(primaryPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(primaryPath, pdfBuffer);
        console.log(`💾 [Receipt Download] Cached generated PDF to disk at: "${primaryPath}"`);
      } catch (saveErr) {
        console.warn('⚠️ Could not cache generated PDF to disk:', saveErr);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(pdfBuffer);
      return;
    }
  } catch (dbErr) {
    console.error('❌ [Receipt Download] Error during DB lookup/generation:', dbErr);
  }

  // 3. If file not on disk AND no matching expense record in DB
  console.error(`❌ [Receipt Download] Failed: File "${filename}" not on disk and no matching DB expense record found.`);
  res.status(404).json({
    success: false,
    message: 'Receipt not found',
  });
});

// Public route to view/download campaign banner images (no auth required)
router.get('/campaigns/:filename', async (req, res) => {
  const filename = req.params.filename as string;

  // Validate filename to prevent path traversal
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    res.status(403).json({ success: false, message: 'Invalid file name' });
    return;
  }

  // 1. Check local disk candidate paths
  const candidates = getCandidateCampaignPaths(filename);
  let existingFilePath: string | null = null;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      existingFilePath = candidate;
      break;
    }
  }

  if (existingFilePath) {
    const lower = filename.toLowerCase();
    let contentType = 'image/jpeg';
    if (lower.endsWith('.png')) contentType = 'image/png';
    else if (lower.endsWith('.webp')) contentType = 'image/webp';
    else if (lower.endsWith('.gif')) contentType = 'image/gif';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const stream = fs.createReadStream(existingFilePath);
    stream.pipe(res);
    return;
  }

  // 2. If not on disk, check if S3 is configured and contains the object
  try {
    const { campaignS3 } = await import('../services/campaignS3Service');
    const s3 = await campaignS3();
    if (s3) {
      const s3Key = `campaigns/${filename}`;
      if (await s3.exists(s3Key)) {
        const signedUrl = await s3.sign(s3Key);
        res.redirect(302, signedUrl);
        return;
      }

    }
  } catch (s3Err) {
    console.error('[CampaignImage] Delivery lookup failed', { filename, code: (s3Err as any)?.code || (s3Err as any)?.name });
    res.status(503).json({success:false,message:'Campaign image storage is temporarily unavailable'});
    return;
  }

  // 3. File not found on disk and not found in S3
  res.status(404).json({
    success: false,
    message: 'Campaign image not found',
  });
});

export default router;
