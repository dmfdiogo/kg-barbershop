import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

export const createService = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId, name, duration, price, description, imageUrl, bufferTime } = req.body;
        const userId = req.user?.userId;

        // Verify ownership
        const shop = await prisma.shop.findUnique({ where: { id: parseInt(shopId) } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized to add services to this shop' });
        }

        const service = await prisma.service.create({
            data: {
                shopId: parseInt(shopId),
                name,
                duration: parseInt(duration),
                price: parseFloat(price),
                description,
                imageUrl,
                bufferTime: bufferTime ? parseInt(bufferTime) : 0
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

export const updateService = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { name, duration, price, description, imageUrl, bufferTime } = req.body;
        const userId = req.user?.userId;

        const service = await prisma.service.findUnique({
            where: { id: parseInt(id) },
            include: { shop: true }
        });

        if (!service || service.shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const updatedService = await prisma.service.update({
            where: { id: parseInt(id) },
            data: {
                name,
                duration: duration ? parseInt(duration) : undefined,
                price: price ? parseFloat(price) : undefined,
                description,
                imageUrl,
                bufferTime: bufferTime !== undefined ? parseInt(bufferTime) : undefined
            }
        });

        res.json(updatedService);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteService = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.userId;

        const service = await prisma.service.findUnique({
            where: { id: parseInt(id) },
            include: { shop: true }
        });

        if (!service || service.shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Delete appointments for this service
        await prisma.appointment.deleteMany({ where: { serviceId: parseInt(id) } });

        await prisma.service.delete({ where: { id: parseInt(id) } });

        res.json({ message: 'Service deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
