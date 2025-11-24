import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

export const createShop = async (req: AuthRequest, res: Response) => {
    try {
        const { name, slug } = req.body;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const existingShop = await prisma.shop.findUnique({ where: { slug } });
        if (existingShop) {
            return res.status(400).json({ error: 'Shop with this slug already exists' });
        }

        const shop = await prisma.shop.create({
            data: {
                name,
                slug,
                ownerId: userId,
            },
        });

        res.status(201).json(shop);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getShopBySlug = async (req: AuthRequest, res: Response) => {
    try {
        const { slug } = req.params;
        const shop = await prisma.shop.findUnique({
            where: { slug },
            include: {
                services: true,
                staff: {
                    include: {
                        user: {
                            select: { name: true }
                        }
                    }
                }
            }
        });

        if (!shop) {
            return res.status(404).json({ error: 'Shop not found' });
        }

        res.json(shop);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getShops = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const role = req.user?.role;

        let whereClause = {};
        if (role === 'ADMIN') {
            whereClause = { ownerId: userId };
        }
        // Customers and Staff see all shops (or we could filter)
        // For MVP, let's return all shops for customers, or maybe just list them

        const shops = await prisma.shop.findMany({
            where: whereClause,
            include: {
                owner: { select: { name: true } },
                _count: { select: { services: true, staff: true } }
            }
        });

        res.json(shops);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const addStaff = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId, email } = req.body;
        const userId = req.user?.userId;

        // Verify shop ownership
        const shop = await prisma.shop.findUnique({ where: { id: shopId } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Find user by email
        const userToAdd = await prisma.user.findUnique({ where: { email } });
        if (!userToAdd) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (userToAdd.role !== 'STAFF') {
            return res.status(400).json({ error: 'User must have STAFF role' });
        }

        // Check if already assigned
        const existingProfile = await prisma.staffProfile.findUnique({ where: { userId: userToAdd.id } });
        if (existingProfile) {
            return res.status(400).json({ error: 'Staff already assigned to a shop' });
        }

        // Create StaffProfile
        const staffProfile = await prisma.staffProfile.create({
            data: {
                userId: userToAdd.id,
                shopId: shopId,
            },
            include: { user: true }
        });

        res.json(staffProfile);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
