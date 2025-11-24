import { Router } from 'express';
import { createAppointment, getAppointments, updateAppointmentStatus, getAvailability, rescheduleAppointment } from '../controllers/appointmentController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createAppointment);
router.get('/', authenticateToken, getAppointments);
router.get('/availability', getAvailability); // Public or protected? Public for now so customers can check
router.patch('/:id/status', authenticateToken, updateAppointmentStatus);
router.patch('/:id/reschedule', authenticateToken, rescheduleAppointment);

export default router;
