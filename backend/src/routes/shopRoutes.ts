import { Router } from 'express';
import { createShop, getShopBySlug, getShops, addStaff } from '../controllers/shopController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createShop);
router.get('/', authenticateToken, getShops);
router.post('/staff', authenticateToken, addStaff);
router.get('/:slug', getShopBySlug);

export default router;
