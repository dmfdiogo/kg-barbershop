import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export class SubscriptionService {
    /**
     * Checks if a user has sufficient credits for a specific service type.
     */
    async hasCredit(userId: number, serviceType: string): Promise<boolean> {
        const subscription = await prisma.subscription.findUnique({
            where: { userId },
            include: { benefits: true },
        });

        if (!subscription || (subscription.status !== 'active' && subscription.status !== 'canceled_at_period_end')) {
            return false;
        }

        const benefit = subscription.benefits.find(b => b.serviceType === serviceType);
        return benefit ? benefit.remaining > 0 : false;
    }

    /**
     * Atomically deducts a credit for a specific service type.
     * Must be called within a transaction if part of a larger operation.
     */
    async deductCredit(userId: number, serviceType: string, tx: Prisma.TransactionClient): Promise<void> {
        // We need to find the specific benefit record to update
        // Since we can't easily query nested relations with specific conditions in a simple update,
        // we first fetch the subscription and benefit ID.
        // Ideally, we should lock the row, but for now we rely on the transaction isolation.

        const subscription = await tx.subscription.findUnique({
            where: { userId },
            include: { benefits: true },
        });

        if (!subscription || (subscription.status !== 'active' && subscription.status !== 'canceled_at_period_end')) {
            throw new Error('No active subscription found');
        }

        const benefit = subscription.benefits.find(b => b.serviceType === serviceType);

        if (!benefit || benefit.remaining <= 0) {
            throw new Error(`Insufficient credits for service: ${serviceType}`);
        }

        await tx.subscriptionBenefit.update({
            where: { id: benefit.id },
            data: { remaining: { decrement: 1 } },
        });
    }

    /**
     * Resets credits for a subscription based on the plan's reset amount.
     * This is typically called by the webhook handler on cycle renewal.
     */
    async resetCredits(subscriptionId: number, tx: Prisma.TransactionClient): Promise<void> {
        const benefits = await tx.subscriptionBenefit.findMany({
            where: { subscriptionId },
        });

        for (const benefit of benefits) {
            await tx.subscriptionBenefit.update({
                where: { id: benefit.id },
                data: { remaining: benefit.resetAmount },
            });
        }

        await tx.subscription.update({
            where: { id: subscriptionId },
            data: { last_reset_date: new Date() }
        });
    }

    /**
     * Clears all credits for a subscription.
     * Used when a subscription is canceled/deleted.
     */
    async clearCredits(subscriptionId: number, tx: Prisma.TransactionClient): Promise<void> {
        await tx.subscriptionBenefit.updateMany({
            where: { subscriptionId },
            data: { remaining: 0 }
        });
    }
}

export const subscriptionService = new SubscriptionService();
