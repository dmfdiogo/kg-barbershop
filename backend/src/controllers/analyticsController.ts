import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

export const getPopularBarbers = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId } = req.query;
        const userId = req.user?.userId;

        // If shopId is provided, verify ownership
        let whereClause: any = {};
        if (shopId) {
            const shop = await prisma.shop.findUnique({ where: { id: Number(shopId) } });
            if (!shop || shop.ownerId !== userId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            whereClause = { shopId: Number(shopId) };
        } else {
            // If no shopId, get all shops owned by user
            const shops = await prisma.shop.findMany({ where: { ownerId: userId } });
            const shopIds = shops.map(s => s.id);
            whereClause = { shopId: { in: shopIds } };
        }

        // Group by barberId and count
        const appointments = await prisma.appointment.groupBy({
            by: ['barberId'],
            where: {
                ...whereClause,
                status: { not: 'CANCELLED' }
            },
            _count: {
                id: true
            },
            orderBy: {
                _count: {
                    id: 'desc'
                }
            },
            take: 5
        });

        // Fetch barber details
        const results = await Promise.all(appointments.map(async (item) => {
            const staffProfile = await prisma.staffProfile.findUnique({
                where: { id: item.barberId },
                include: { user: { select: { name: true } } }
            });
            return {
                name: staffProfile?.user.name || 'Unknown',
                count: item._count.id
            };
        }));

        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getPeakHours = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId } = req.query;
        const userId = req.user?.userId;

        let whereClause: any = {};
        if (shopId) {
            const shop = await prisma.shop.findUnique({ where: { id: Number(shopId) } });
            if (!shop || shop.ownerId !== userId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            whereClause = { shopId: Number(shopId) };
        } else {
            const shops = await prisma.shop.findMany({ where: { ownerId: userId } });
            const shopIds = shops.map(s => s.id);
            whereClause = { shopId: { in: shopIds } };
        }

        // Fetch all appointments (for MVP this is fine, for scale we'd need raw SQL or aggregation)
        const appointments = await prisma.appointment.findMany({
            where: {
                ...whereClause,
                status: { not: 'CANCELLED' }
            },
            select: { startTime: true }
        });

        // Process in memory
        const hoursMap = new Array(24).fill(0);
        appointments.forEach(appt => {
            const hour = new Date(appt.startTime).getHours();
            hoursMap[hour]++;
        });

        const data = hoursMap.map((count, hour) => ({
            hour: `${hour}:00`,
            count
        }));

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
