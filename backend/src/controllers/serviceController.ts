import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

export const createService = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId, name, duration, price } = req.body;
        const userId = req.user?.userId;

        // Verify ownership
        const shop = await prisma.shop.findUnique({ where: { id: shopId } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized to add services to this shop' });
        }

        const service = await prisma.service.create({
            data: {
                shopId,
                name,
                duration,
                price,
            },
        });

        res.status(201).json(service);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getServicesByShop = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId } = req.params;
        const services = await prisma.service.findMany({
            where: { shopId: parseInt(shopId) },
        });

        res.json(services);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
