import { Router } from 'express';
import { createService, getServicesByShop } from '../controllers/serviceController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createService);
router.get('/shop/:shopId', getServicesByShop);

export default router;
