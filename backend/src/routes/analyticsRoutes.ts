import { Router } from 'express';
import { getPopularBarbers, getPeakHours, getRevenueAnalytics, getAppointmentStatusStats, getCustomerRetention } from '../controllers/analyticsController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.get('/popular-barbers', authenticateToken, getPopularBarbers);
router.get('/peak-hours', authenticateToken, getPeakHours);
router.get('/revenue', authenticateToken, getRevenueAnalytics);
router.get('/status', authenticateToken, getAppointmentStatusStats);
router.get('/retention', authenticateToken, getCustomerRetention);

export default router;
