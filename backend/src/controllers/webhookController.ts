import { Request, Response } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-11-17.clover',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const handleStripeWebhook = async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];

    let event: Stripe.Event;

    try {
        if (!endpointSecret || !sig) {
            throw new Error('Missing webhook secret or signature');
        }
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'invoice.payment_succeeded':
            const invoice = event.data.object as Stripe.Invoice;
            await handlePaymentSucceeded(invoice);
            break;
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object as Stripe.Invoice;
            await handlePaymentFailed(failedInvoice);
            break;
        case 'checkout.session.completed':
            const session = event.data.object as Stripe.Checkout.Session;
            await handleCheckoutSessionCompleted(session);
            break;
        case 'customer.subscription.deleted':
            const subscription = event.data.object as Stripe.Subscription;
            await handleSubscriptionDeleted(subscription);
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
};

import { subscriptionService } from '../services/subscriptionService';

const handleCheckoutSessionCompleted = async (session: Stripe.Checkout.Session) => {
    const sessionId = session.id;
    console.log(`Processing checkout session completed: ${sessionId}`);

    try {
        // Handle Subscription Checkout
        if (session.mode === 'subscription') {
            const subscriptionId = session.subscription as string;
            const userId = session.client_reference_id;

            if (!userId) {
                console.error(`No client_reference_id (userId) found in session ${sessionId}`);
                return;
            }

            console.log(`Processing new subscription ${subscriptionId} for user ${userId}`);

            // Retrieve full subscription details from Stripe
            const subscription: any = await stripe.subscriptions.retrieve(subscriptionId);

            console.log('Stripe Subscription Object:', JSON.stringify(subscription, null, 2));

            const currentPeriodEnd = subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000)
                : new Date(); // Fallback to now if missing (should not happen)

            // Upsert subscription in DB
            await prisma.subscription.upsert({
                where: { userId: parseInt(userId) },
                update: {
                    stripeSubscriptionId: subscription.id,
                    status: subscription.status,
                    currentPeriodEnd: currentPeriodEnd,
                    planId: subscription.items.data[0].price.id,
                },
                create: {
                    userId: parseInt(userId),
                    stripeSubscriptionId: subscription.id,
                    status: subscription.status,
                    currentPeriodEnd: currentPeriodEnd,
                    planId: subscription.items.data[0].price.id,
                },
            });

            // Initialize benefits for the new subscription
            // We can call the logic from handlePaymentSucceeded or just duplicate/refactor it.
            // Since handlePaymentSucceeded handles benefits on invoice payment (which happens immediately after this),
            // we might not need to do it here to avoid double crediting.
            // BUT, handlePaymentSucceeded relies on the subscription existing in DB.
            // So by creating it here, we ensure handlePaymentSucceeded works!

            console.log(`Subscription ${subscriptionId} created/updated in DB`);
            return;
        }

        // Handle One-Time Payment Checkout
        // Find the appointment associated with this session
        const appointment = await prisma.appointment.findFirst({
            where: { stripeSessionId: sessionId }
        });

        if (!appointment) {
            console.error(`Appointment not found for session ID: ${sessionId}`);
            // It might be a subscription checkout, which is handled by invoice.payment_succeeded usually,
            // but for initial subscription checkout, it might also trigger this.
            // However, our subscription flow uses a different logic (subscriptionService).
            // If we want to support subscription via checkout session in the future, we'd check metadata.
            return;
        }

        // Update appointment status
        await prisma.appointment.update({
            where: { id: appointment.id },
            data: {
                paymentStatus: 'PAID',
                status: 'CONFIRMED' // Auto-confirm if paid? Or keep as PENDING until barber confirms? 
                // Usually paid = confirmed for booking apps.
            }
        });

        console.log(`Appointment ${appointment.id} marked as PAID and CONFIRMED`);
    } catch (error) {
        console.error('Error handling checkout session completed:', error);
    }
};

const handlePaymentSucceeded = async (invoice: any) => {
    if (!invoice.subscription) return;

    const subscriptionId = invoice.subscription as string;
    const customerId = invoice.customer as string;

    console.log(`Processing payment success for subscription: ${subscriptionId}`);

    try {
        await prisma.$transaction(async (tx) => {
            // Find subscription in DB
            const subscription = await tx.subscription.findUnique({
                where: { stripeSubscriptionId: subscriptionId },
                include: { benefits: true }
            });

            if (!subscription) {
                console.error(`Subscription not found for ID: ${subscriptionId}`);
                return;
            }

            // Initialize benefits if they don't exist (Migration/First run logic)
            if (subscription.benefits.length === 0) {
                // Default MVP Plan: 2 Haircuts, 1 Beard
                await tx.subscriptionBenefit.create({
                    data: {
                        subscriptionId: subscription.id,
                        serviceType: 'HAIRCUT',
                        remaining: 2,
                        resetAmount: 2
                    }
                });
                await tx.subscriptionBenefit.create({
                    data: {
                        subscriptionId: subscription.id,
                        serviceType: 'BEARD',
                        remaining: 1,
                        resetAmount: 1
                    }
                });
            } else {
                // Reset existing benefits (Flow 3: Renewal)
                await subscriptionService.resetCredits(subscription.id, tx);
            }

            // Update subscription status and period
            await tx.subscription.update({
                where: { id: subscription.id },
                data: {
                    status: 'active',
                    currentPeriodEnd: new Date(invoice.lines.data[0].period.end * 1000),
                },
            });
        });

        console.log(`Credits processed for subscription ${subscriptionId}`);
    } catch (error) {
        console.error('Error handling payment success:', error);
    }
};

const handlePaymentFailed = async (invoice: any) => {
    if (!invoice.subscription) return;

    const subscriptionId = invoice.subscription as string;

    try {
        await prisma.subscription.update({
            where: { stripeSubscriptionId: subscriptionId },
            data: {
                status: 'suspended', // Flow 3: Failure -> Suspended
            },
        });
        console.log(`Subscription ${subscriptionId} marked as suspended`);
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
};

const handleSubscriptionDeleted = async (subscription: any) => {
    const subscriptionId = subscription.id;
    console.log(`Processing subscription deletion: ${subscriptionId}`);

    try {
        await prisma.$transaction(async (tx) => {
            const sub = await tx.subscription.findUnique({
                where: { stripeSubscriptionId: subscriptionId }
            });

            if (!sub) {
                console.error(`Subscription not found for ID: ${subscriptionId}`);
                return;
            }

            // Update status to canceled
            await tx.subscription.update({
                where: { id: sub.id },
                data: { status: 'canceled' }
            });

            // Clear credits (Flow 3: Deletion -> Entitlement 0)
            await subscriptionService.clearCredits(sub.id, tx);
        });

        console.log(`Subscription ${subscriptionId} canceled and credits cleared`);
    } catch (error) {
        console.error('Error handling subscription deletion:', error);
    }
};
