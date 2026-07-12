import { Router } from 'express';
import { addSales, updateSales, addCreditNote, addSalesExchange, syncSalesBatch } from '../../controllers/salesLegacyController';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { apiKeyMiddleware } from '../../middlewares/apiKeyMiddleware';

const router = Router();

// Apply auth and apiKey middlewares to all routes
router.use(authMiddleware);
router.use(apiKeyMiddleware);

router.post('/Sync', syncSalesBatch);

/**
 * @swagger
 * /api/Sales/AddSales:
 *   post:
 *     summary: Add new sales transaction (Legacy endpoint)
 *     tags: [Legacy - Sales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         schema:
 *           type: string
 *         required: true
 *         description: API Key for security
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - saleAmount
 *             properties:
 *               billId:
 *                 type: string
 *               invoiceNumber:
 *                 type: string
 *               saleAmount:
 *                 type: number
 *               storeId:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Sale added and commission transaction created successfully
 *       400:
 *         description: Invalid input parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Invalid API Key
 *       500:
 *         description: Server error
 */
router.post('/AddSales', addSales);

/**
 * @swagger
 * /api/Sales/UpdateSales:
 *   post:
 *     summary: Update existing sales transaction (Legacy endpoint)
 *     tags: [Legacy - Sales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         schema:
 *           type: string
 *         required: true
 *         description: API Key for security
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionId
 *               - saleAmount
 *             properties:
 *               transactionId:
 *                 type: integer
 *               billId:
 *                 type: string
 *               invoiceNumber:
 *                 type: string
 *               saleAmount:
 *                 type: number
 *               storeId:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Sales transaction updated successfully
 *       400:
 *         description: Invalid input parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Invalid API Key
 *       500:
 *         description: Server error
 */
router.post('/UpdateSales', updateSales);

/**
 * @swagger
 * /api/Sales/AddCreditNote:
 *   post:
 *     summary: Add credit note for return/refund (Legacy endpoint)
 *     tags: [Legacy - Sales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         schema:
 *           type: string
 *         required: true
 *         description: API Key for security
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - returnAmount
 *             properties:
 *               creditNoteNumber:
 *                 type: string
 *               returnAmount:
 *                 type: number
 *               originalInvoiceNumber:
 *                 type: string
 *               storeId:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Credit note added and negative commission transaction created successfully
 *       400:
 *         description: Invalid input parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Invalid API Key
 *       500:
 *         description: Server error
 */
router.post('/AddCreditNote', addCreditNote);

/**
 * @swagger
 * /api/Sales/AddSalesExchange:
 *   post:
 *     summary: Add sales exchange transaction (Legacy endpoint)
 *     tags: [Legacy - Sales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         schema:
 *           type: string
 *         required: true
 *         description: API Key for security
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - saleAmount
 *               - returnAmount
 *             properties:
 *               billId:
 *                 type: string
 *               invoiceNumber:
 *                 type: string
 *               saleAmount:
 *                 type: number
 *               returnAmount:
 *                 type: number
 *               exchangeInvoiceNumber:
 *                 type: string
 *               storeId:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Sales exchange transaction processed successfully
 *       400:
 *         description: Invalid input parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Invalid API Key
 *       500:
 *         description: Server error
 */
router.post('/AddSalesExchange', addSalesExchange);

export default router;
