import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

export const getAllGlobalServices = async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const services = await prisma.globalService.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: { services: true }
                },
                services: {
                    include: {
                        shop: {
                            select: { id: true, name: true }
                        }
                    }
                }
            }
        });

        res.json(services);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createGlobalService = async (req: AuthRequest, res: Response) => {
    try {
        const { name, description, imageUrl, type, defaultDuration, defaultPrice } = req.body;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const service = await prisma.globalService.create({
            data: {
                name,
                description,
                imageUrl,
                type: type || 'OTHER',
                defaultDuration: parseInt(defaultDuration),
                defaultPrice: parseFloat(defaultPrice)
            }
        });

        res.status(201).json(service);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const assignServiceToShop = async (req: AuthRequest, res: Response) => {
    try {
        const { globalServiceId, shopId, price, duration } = req.body;
        const userId = req.user?.userId;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Verify shop ownership (optional if we trust admin, but good practice)
        // Actually, if it's global admin, maybe they can assign to any shop?
        // But our current model is Shop Owner = Admin for that shop.
        // Let's assume the user must own the shop.
        const shop = await prisma.shop.findUnique({ where: { id: shopId } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized for this shop' });
        }

        const globalService = await prisma.globalService.findUnique({ where: { id: globalServiceId } });
        if (!globalService) {
            return res.status(404).json({ error: 'Global service not found' });
        }

        // Check if already assigned
        const existingService = await prisma.service.findFirst({
            where: { shopId, globalServiceId }
        });

        if (existingService) {
            return res.status(400).json({ error: 'Service already assigned to this shop' });
        }

        const service = await prisma.service.create({
            data: {
                shopId,
                globalServiceId,
                name: globalService.name,
                description: globalService.description,
                imageUrl: globalService.imageUrl,
                type: globalService.type,
                duration: duration ? parseInt(duration) : globalService.defaultDuration,
                price: price ? parseFloat(price) : globalService.defaultPrice
            }
        });

        res.status(201).json(service);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteGlobalService = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Check if used
        const usageCount = await prisma.service.count({
            where: { globalServiceId: parseInt(id) }
        });

        if (usageCount > 0) {
            return res.status(400).json({ error: 'Cannot delete service that is assigned to shops' });
        }

        await prisma.globalService.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Global service deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const removeServiceFromShop = async (req: AuthRequest, res: Response) => {
    try {
        const { globalServiceId, shopId } = req.body;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const service = await prisma.service.findFirst({
            where: { globalServiceId, shopId }
        });

        if (!service) {
            return res.status(404).json({ error: 'Service not found in this shop' });
        }

        const futureAppointments = await prisma.appointment.count({
            where: {
                serviceId: service.id,
                startTime: { gte: new Date() },
                status: { in: ['PENDING', 'CONFIRMED'] }
            }
        });

        if (futureAppointments > 0) {
            return res.status(400).json({ error: 'Cannot remove service with future appointments' });
        }

        await prisma.service.delete({
            where: { id: service.id }
        });

        res.json({ message: 'Service removed from shop' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
