import { Response } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover', // Use version matching installed types
});

const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY;

export const createSubscriptionSession = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!STRIPE_PRICE_ID) {
            return res.status(500).json({ error: 'Subscription price not configured' });
        }

        // Check if user already has an active subscription
        const existingSubscription = await prisma.subscription.findUnique({
            where: { userId }
        });

        if (existingSubscription && existingSubscription.status === 'active') {
            return res.status(400).json({ error: 'User already has an active subscription' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: STRIPE_PRICE_ID,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5101'}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5101'}/plans`,
        });

        res.json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe subscription error:', error);
        res.status(500).json({ error: error.message || 'Failed to create subscription session' });
    }
};

export const getSubscriptionStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { userId }
        });

        res.json(subscription);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const handleSubscriptionSuccess = async (req: AuthRequest, res: Response) => {
    try {
        const { sessionId } = req.body;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const subscriptionId = session.subscription as string;

        if (!subscriptionId) {
            return res.status(400).json({ error: 'No subscription found in session' });
        }

        const subscription: any = await stripe.subscriptions.retrieve(subscriptionId);

        // Upsert subscription in DB
        await prisma.subscription.upsert({
            where: { userId },
            update: {
                stripeSubscriptionId: subscription.id,
                status: subscription.status,
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                planId: subscription.items.data[0].price.id,
            },
            create: {
                userId,
                stripeSubscriptionId: subscription.id,
                status: subscription.status,
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                planId: subscription.items.data[0].price.id,
            },
        });

        res.json({ success: true });
    } catch (error: any) {
        console.error('Subscription verification error:', error);
        res.status(500).json({ error: error.message || 'Failed to verify subscription' });
    }
};


export const cancelSubscription = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { userId }
        });

        if (!subscription || !subscription.stripeSubscriptionId) {
            return res.status(404).json({ error: 'No active subscription found' });
        }

        // Cancel at period end
        const updatedStripeSub: any = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true,
        });

        // Update DB
        const updatedSub = await prisma.subscription.update({
            where: { userId },
            data: {
                status: 'canceled_at_period_end', // Or whatever status Stripe returns, usually 'active' with cancel_at_period_end=true until it expires
                // But for simplicity let's just mark it as such or rely on webhook.
                // Actually, let's just return success and let the UI show "Cancels on [date]"
            }
        });

        res.json({ success: true, currentPeriodEnd: updatedStripeSub.current_period_end });
    } catch (error: any) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ error: error.message || 'Failed to cancel subscription' });
    }
};


export const verifySubscription = async (req: AuthRequest, res: Response) => {
    try {
        const { sessionId } = req.body;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 1. Retrieve session from Stripe to get subscription ID
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const subscriptionId = session.subscription as string;

        if (!subscriptionId) {
            return res.status(400).json({ error: 'No subscription found in session' });
        }

        // 2. Check if we have this subscription in our DB
        const subscription = await prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subscriptionId }
        });

        if (subscription) {
            return res.json({ status: 'success', subscription });
        } else {
            // Webhook hasn't processed it yet.
            // We could optionally fetch from Stripe and insert here as a fallback, 
            // but to avoid race conditions, let's just tell frontend to wait/retry or return 'pending'.
            // For better UX, let's return 'pending' and let frontend poll or just show "Processing".
            return res.json({ status: 'pending' });
        }
    } catch (error: any) {
        console.error('Verify subscription error:', error);
        res.status(500).json({ error: error.message || 'Failed to verify subscription' });
    }
};
