import { Router } from 'express';
import { getAllGlobalServices, createGlobalService, assignServiceToShop, deleteGlobalService, removeServiceFromShop } from '../controllers/globalServiceController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authenticateToken, getAllGlobalServices);
router.post('/', authenticateToken, createGlobalService);
router.post('/assign', authenticateToken, assignServiceToShop);
router.post('/remove', authenticateToken, removeServiceFromShop);
router.delete('/:id', authenticateToken, deleteGlobalService);

export default router;
