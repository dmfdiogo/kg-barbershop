import { Router } from 'express';
import { createService, getServicesByShop, updateService, deleteService } from '../controllers/serviceController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createService);
router.get('/shop/:shopId', getServicesByShop);
router.put('/:id', authenticateToken, updateService);
router.delete('/:id', authenticateToken, deleteService);

export default router;
