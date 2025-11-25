import { Router } from 'express';
import { createSchedule, getSchedule } from '../controllers/scheduleController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createSchedule);
router.get('/', authenticateToken, getSchedule);

export default router;
