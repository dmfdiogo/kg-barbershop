import { Response } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover', // Use version matching installed types
});

export const createCheckoutSession = async (req: AuthRequest, res: Response) => {
    try {
        const { appointmentId } = req.body;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: { service: true }
        });

        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        if (appointment.customerId !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'brl', // Assuming BRL based on user screenshot
                        product_data: {
                            name: appointment.service.name,
                            description: appointment.service.description || 'Barber Service',
                            images: appointment.service.imageUrl ? [appointment.service.imageUrl] : [],
                        },
                        unit_amount: Math.round(Number(appointment.service.price) * 100), // Stripe expects cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5101'}/payment/success?session_id={CHECKOUT_SESSION_ID}&appointment_id=${appointmentId}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5101'}/payment/cancel?appointment_id=${appointmentId}`,
        });

        // Update appointment with session ID
        await prisma.appointment.update({
            where: { id: appointmentId },
            data: { stripeSessionId: session.id }
        });

        res.json({ url: session.url });
    } catch (error: any) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message || 'Failed to create checkout session' });
    }
};

export const handlePaymentSuccess = async (req: AuthRequest, res: Response) => {
    try {
        const { sessionId, appointmentId } = req.body;

        // Verify session with Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
            await prisma.appointment.update({
                where: { id: parseInt(appointmentId) },
                data: { paymentStatus: 'PAID' }
            });
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Payment not completed' });
        }
    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
};
