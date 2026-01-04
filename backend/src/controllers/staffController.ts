import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const getAllStaff = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        // Only admin can see all staff
        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const staff = await prisma.user.findMany({
            where: {
                role: { in: ['STAFF', 'ADMIN'] }
            },
            include: {
                staffProfiles: {
                    include: {
                        shop: {
                            select: { id: true, name: true }
                        }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        res.json(staff);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createStaffUser = async (req: AuthRequest, res: Response) => {
    try {
        const { name, email, password, role } = req.body;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password_hash: passwordHash,
                role: role || 'STAFF'
            }
        });

        res.status(201).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const assignStaffToShop = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, shopId } = req.body;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Check if already assigned
        const existingProfile = await prisma.staffProfile.findFirst({
            where: { userId, shopId }
        });

        if (existingProfile) {
            if (existingProfile.deletedAt) {
                // Reactivate
                await prisma.staffProfile.update({
                    where: { id: existingProfile.id },
                    data: { deletedAt: null }
                });
                return res.json({ message: 'Staff reassigned to shop' });
            }
            return res.status(400).json({ error: 'Staff already assigned to this shop' });
        }

        await prisma.staffProfile.create({
            data: {
                userId,
                shopId
            }
        });

        res.json({ message: 'Staff assigned to shop successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const removeStaffFromShop = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, shopId } = req.body;

        if (req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const profile = await prisma.staffProfile.findFirst({
            where: { userId, shopId }
        });

        if (!profile) {
            return res.status(404).json({ error: 'Staff profile not found for this shop' });
        }

        // Soft delete
        await prisma.staffProfile.update({
            where: { id: profile.id },
            data: { deletedAt: new Date() }
        });

        // Cancel future appointments? (Logic similar to shopController.removeStaff)
        await prisma.appointment.deleteMany({
            where: {
                barberId: profile.id,
                startTime: { gte: new Date() }
            }
        });

        res.json({ message: 'Staff removed from shop' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
