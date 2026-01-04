import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';
import bcrypt from 'bcrypt';

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
                    where: { deletedAt: null },
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
                _count: {
                    select: {
                        services: true,
                        staff: { where: { deletedAt: null } }
                    }
                }
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

        // Check if already assigned (including soft deleted)
        const existingProfile = await prisma.staffProfile.findFirst({
            where: { userId: userToAdd.id, shopId: shopId }
        });

        if (existingProfile) {
            if (existingProfile.deletedAt) {
                // Reactivate soft-deleted profile
                const reactivatedProfile = await prisma.staffProfile.update({
                    where: { id: existingProfile.id },
                    data: { deletedAt: null, shopId: shopId }, // Ensure shopId is correct (though it should be)
                    include: { user: true }
                });
                return res.json(reactivatedProfile);
            } else {
                return res.status(400).json({ error: 'Staff already assigned to a shop' });
            }
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

export const createStaffUser = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId, name, email, password, role } = req.body;
        const userId = req.user?.userId;

        // Verify shop ownership
        const shop = await prisma.shop.findUnique({ where: { id: Number(shopId) } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Check if user exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists. Use "Add Existing Staff" instead.' });
        }

        // Validate role
        if (role && !['STAFF', 'ADMIN'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be STAFF or ADMIN.' });
        }

        // Create User
        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                email,
                password_hash: passwordHash,
                name,
                role: role || 'STAFF',
            },
        });

        // Create StaffProfile
        const staffProfile = await prisma.staffProfile.create({
            data: {
                userId: newUser.id,
                shopId: Number(shopId),
            },
            include: { user: true }
        });

        res.status(201).json(staffProfile);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateShop = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { name, slug } = req.body;
        const userId = req.user?.userId;

        const shop = await prisma.shop.findUnique({ where: { id: parseInt(id) } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const updatedShop = await prisma.shop.update({
            where: { id: parseInt(id) },
            data: { name, slug }
        });

        res.json(updatedShop);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteShop = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.userId;

        const shop = await prisma.shop.findUnique({ where: { id: parseInt(id) } });
        if (!shop || shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Delete shop (Prisma should cascade if configured, but let's see. 
        // If not, we might need to delete related records first. 
        // Assuming cascade delete is NOT set up in schema for simplicity unless we checked.
        // Let's try deleting. If it fails due to FK constraints, we'll know.)
        // Actually, for a robust implementation, let's delete related data or rely on cascade.
        // Checking schema... we didn't explicitly set onDelete: Cascade.
        // So we should delete related data.

        // Delete appointments
        await prisma.appointment.deleteMany({ where: { shopId: parseInt(id) } });

        // Get staff IDs to delete their schedules
        const staff = await prisma.staffProfile.findMany({
            where: { shopId: parseInt(id) },
            select: { id: true }
        });
        const staffIds = staff.map(s => s.id);

        if (staffIds.length > 0) {
            // Delete breaks associated with schedules
            await prisma.break.deleteMany({
                where: { schedule: { barberId: { in: staffIds } } }
            });

            // Delete schedules
            await prisma.schedule.deleteMany({
                where: { barberId: { in: staffIds } }
            });
        }

        // Delete services
        await prisma.service.deleteMany({ where: { shopId: parseInt(id) } });
        // Delete staff profiles
        await prisma.staffProfile.deleteMany({ where: { shopId: parseInt(id) } });

        await prisma.shop.delete({ where: { id: parseInt(id) } });

        res.json({ message: 'Shop deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const removeStaff = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params; // StaffProfile ID
        const userId = req.user?.userId;

        const staffProfile = await prisma.staffProfile.findUnique({
            where: { id: parseInt(id) },
            include: { shop: true }
        });

        if (!staffProfile) {
            return res.status(404).json({ error: 'Staff not found' });
        }

        if (staffProfile.shop.ownerId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Delete appointments for this staff? Or keep them?
        // Probably should keep them or reassign? For now, let's delete future appointments?
        // Or just delete the profile and let appointments hang (bad).
        // Let's set appointments barberId to null? No, it's required.
        // Let's delete future appointments.

        await prisma.appointment.deleteMany({
            where: {
                barberId: parseInt(id),
                startTime: { gte: new Date() }
            }
        });

        await prisma.staffProfile.update({
            where: { id: parseInt(id) },
            data: { deletedAt: new Date() }
        });

        res.json({ message: 'Staff removed successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
