import { Router } from 'express';
import { setSchedule, getSchedule } from '../controllers/scheduleController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, setSchedule);
router.get('/', authenticateToken, getSchedule);

export default router;
