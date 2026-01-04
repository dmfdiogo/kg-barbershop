import { Router } from 'express';
import { getAllStaff, createStaffUser, assignStaffToShop, removeStaffFromShop } from '../controllers/staffController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authenticateToken, getAllStaff);
router.post('/', authenticateToken, createStaffUser);
router.post('/assign', authenticateToken, assignStaffToShop);
router.post('/remove', authenticateToken, removeStaffFromShop);

export default router;
