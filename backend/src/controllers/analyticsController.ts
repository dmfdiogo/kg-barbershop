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

export const getPeakDays = async (req: AuthRequest, res: Response) => {
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

        const appointments = await prisma.appointment.findMany({
            where: {
                ...whereClause,
                status: { not: 'CANCELLED' }
            },
            select: { startTime: true }
        });

        const daysMap = new Array(7).fill(0);
        appointments.forEach(appt => {
            const day = new Date(appt.startTime).getDay();
            daysMap[day]++;
        });

        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const data = daysMap.map((count, index) => ({
            day: days[index],
            count
        }));

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getRevenueAnalytics = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId, period = 'daily' } = req.query; // period: 'daily' | 'monthly'
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

        // Get appointments with service details for price
        const appointments = await prisma.appointment.findMany({
            where: {
                ...whereClause,
                status: 'COMPLETED', // Only count completed appointments for revenue
                startTime: {
                    gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) // Last 6 months
                }
            },
            include: {
                service: {
                    select: { price: true }
                }
            },
            orderBy: { startTime: 'asc' }
        });

        // Group by date
        const revenueMap = new Map<string, number>();

        appointments.forEach(appt => {
            const date = new Date(appt.startTime);
            let key = '';
            if (period === 'monthly') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
            } else {
                key = date.toISOString().split('T')[0]; // YYYY-MM-DD
            }

            const current = revenueMap.get(key) || 0;
            revenueMap.set(key, current + Number(appt.service.price));
        });

        const data = Array.from(revenueMap.entries()).map(([date, amount]) => ({
            date,
            amount
        }));

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAppointmentStatusStats = async (req: AuthRequest, res: Response) => {
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

        const stats = await prisma.appointment.groupBy({
            by: ['status'],
            where: whereClause,
            _count: {
                id: true
            }
        });

        const data = stats.map(stat => ({
            name: stat.status,
            value: stat._count.id
        }));

        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCustomerRetention = async (req: AuthRequest, res: Response) => {
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

        // Get all customer IDs who have appointments
        const appointments = await prisma.appointment.groupBy({
            by: ['customerId'],
            where: {
                ...whereClause,
                status: 'COMPLETED'
            },
            _count: {
                id: true
            }
        });

        let newCustomers = 0;
        let returningCustomers = 0;

        appointments.forEach(appt => {
            if (appt._count.id > 1) {
                returningCustomers++;
            } else {
                newCustomers++;
            }
        });

        res.json([
            { name: 'New Customers', value: newCustomers },
            { name: 'Returning Customers', value: returningCustomers }
        ]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
