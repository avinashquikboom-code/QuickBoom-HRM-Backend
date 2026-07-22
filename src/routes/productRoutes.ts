import { Router } from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getSizes,
  addSize,
  getColors,
  addColor,
} from '../controllers/productController';

const router = Router();

router.get('/', getProducts);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

// Dynamic sizes & colors management
router.get('/sizes', getSizes);
router.post('/sizes', addSize);
router.get('/colors', getColors);
router.post('/colors', addColor);

export default router;
