import { Router } from 'express';
import { getHome } from '../controllers/homeController';

const router = Router();

router.get('/', getHome);

export default router;
