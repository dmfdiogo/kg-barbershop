import { Router } from 'express';
import { createShop, getShopBySlug, getShops, addStaff, updateShop, deleteShop, removeStaff } from '../controllers/shopController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createShop);
router.get('/', authenticateToken, getShops);
router.put('/:id', authenticateToken, updateShop);
router.delete('/:id', authenticateToken, deleteShop);

router.post('/staff', authenticateToken, addStaff);
router.delete('/staff/:id', authenticateToken, removeStaff);

router.get('/:slug', getShopBySlug);

export default router;
