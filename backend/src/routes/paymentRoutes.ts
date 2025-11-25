import { Router } from 'express';
import { createCheckoutSession, handlePaymentSuccess } from '../controllers/paymentController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/create-checkout-session', authenticateToken, createCheckoutSession);
router.post('/success', authenticateToken, handlePaymentSuccess);

export default router;
