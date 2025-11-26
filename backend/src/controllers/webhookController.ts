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
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
};

const handlePaymentSucceeded = async (invoice: any) => {
    if (!invoice.subscription) return;

    const subscriptionId = invoice.subscription as string;
    const customerId = invoice.customer as string;

    console.log(`Processing payment success for subscription: ${subscriptionId}`);

    try {
        // Find subscription in DB
        const subscription = await prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subscriptionId },
        });

        if (!subscription) {
            console.error(`Subscription not found for ID: ${subscriptionId}`);
            return;
        }

        // Reset credits
        // Logic: 2 Haircuts, 1 Beard Trim (Hardcoded for MVP as per request)
        // Ideally, this should come from a Plan configuration in DB or code
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                status: 'active',
                credits_haircut: 2,
                credits_beard: 1,
                last_reset_date: new Date(),
                currentPeriodEnd: new Date(invoice.lines.data[0].period.end * 1000), // Update period end
            },
        });

        console.log(`Credits reset for user ${subscription.userId}`);
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
                status: 'past_due',
                // Optionally lock credits here if needed, but status check should suffice
            },
        });
        console.log(`Subscription ${subscriptionId} marked as past_due`);
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
};
