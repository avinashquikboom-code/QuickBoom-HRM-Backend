import { Router } from 'express';
import { getInvoiceDetails } from '../controllers/invoiceController';

const router = Router();

router.get('/:transactionId', getInvoiceDetails);

export default router;
