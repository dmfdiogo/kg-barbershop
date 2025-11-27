import { Router } from 'express';
import { createCheckoutSession, handlePaymentSuccess, verifySession } from '../controllers/paymentController';
import { createSubscriptionSession, handleSubscriptionSuccess, getSubscriptionStatus, cancelSubscription, verifySubscription } from '../controllers/subscriptionController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/create-checkout-session', authenticateToken, createCheckoutSession);
router.post('/success', authenticateToken, handlePaymentSuccess);
router.get('/verify-session/:sessionId', authenticateToken, verifySession);

// Subscription routes
router.post('/create-subscription-session', authenticateToken, createSubscriptionSession);
router.post('/subscription-success', authenticateToken, handleSubscriptionSuccess); // Keeping for backward compat if needed, but verify is preferred
router.post('/verify-subscription', authenticateToken, verifySubscription);
router.post('/cancel-subscription', authenticateToken, cancelSubscription);
router.get('/subscription-status', authenticateToken, getSubscriptionStatus);

export default router;
