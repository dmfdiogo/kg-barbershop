import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

// Upsert schedule for a barber
// Expects body: { schedules: [{ dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isAvailable: true }, ...] }
export const setSchedule = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { schedules } = req.body;

        // Get StaffProfile
        const staffProfile = await prisma.staffProfile.findUnique({
            where: { userId },
        });

        if (!staffProfile) {
            return res.status(404).json({ error: 'Staff profile not found' });
        }

        // Transaction to replace existing schedules for the days provided or all?
        // For simplicity, let's replace all schedules for this barber
        await prisma.$transaction([
            prisma.schedule.deleteMany({ where: { barberId: staffProfile.id } }),
            prisma.schedule.createMany({
                data: schedules.map((s: any) => ({
                    barberId: staffProfile.id,
                    dayOfWeek: s.dayOfWeek,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    isAvailable: s.isAvailable,
                })),
            }),
        ]);

        res.json({ message: 'Schedule updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSchedule = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        // If staff, get own schedule. If admin/customer, might need to pass barberId?
        // For now, let's assume this is for the logged-in staff to view their schedule.
        // We'll add a public endpoint or query param for customers later if needed,
        // but customers usually just need availability slots.

        const staffProfile = await prisma.staffProfile.findUnique({
            where: { userId },
        });

        if (!staffProfile) {
            return res.status(404).json({ error: 'Staff profile not found' });
        }

        const schedule = await prisma.schedule.findMany({
            where: { barberId: staffProfile.id },
            orderBy: { dayOfWeek: 'asc' }
        });

        res.json(schedule);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
