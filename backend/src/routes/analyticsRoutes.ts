import { Router } from 'express';
import { getPopularBarbers, getPeakHours } from '../controllers/analyticsController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.get('/popular-barbers', authenticateToken, getPopularBarbers);
router.get('/peak-hours', authenticateToken, getPeakHours);

export default router;
