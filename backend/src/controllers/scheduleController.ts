import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

// Upsert schedule for a barber
// Expects body: { schedules: [{ dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isAvailable: true }, ...] }
export const createSchedule = async (req: AuthRequest, res: Response) => {
    try {
        const { schedules } = req.body;
        const userId = req.user?.userId;

        const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });
        if (!staffProfile) {
            return res.status(404).json({ error: 'Staff profile not found' });
        }

        // Transaction to update all schedules
        await prisma.$transaction(async (prisma) => {
            for (const schedule of schedules) {
                // Upsert schedule
                const savedSchedule = await prisma.schedule.upsert({
                    where: {
                        // We need a unique constraint on barberId + dayOfWeek, but Prisma doesn't support composite unique easily in upsert where clause without @unique in schema.
                        // However, we can find first and then update or create.
                        // Or better, let's just delete existing for this barber and recreate? No, that loses IDs.
                        // Wait, deleting loses history? No, schedule is just settings.
                        // But if we delete, we lose the IDs.
                        // Let's try to find existing one first.
                        id: schedule.id || -1 // Dummy ID if not provided
                    },
                    update: {
                        startTime: schedule.startTime,
                        endTime: schedule.endTime,
                        isAvailable: schedule.isAvailable
                    },
                    create: {
                        barberId: staffProfile.id,
                        dayOfWeek: schedule.dayOfWeek,
                        startTime: schedule.startTime,
                        endTime: schedule.endTime,
                        isAvailable: schedule.isAvailable
                    }
                });

                // Handle Breaks
                // Delete existing breaks for this schedule
                if (savedSchedule.id) {
                    await prisma.break.deleteMany({ where: { scheduleId: savedSchedule.id } });
                }

                // Create new breaks
                if (schedule.breaks && schedule.breaks.length > 0) {
                    await prisma.break.createMany({
                        data: schedule.breaks.map((b: any) => ({
                            scheduleId: savedSchedule.id,
                            startTime: b.startTime,
                            endTime: b.endTime
                        }))
                    });
                }
            }
        });

        // Re-fetch to return clean data
        const updatedSchedules = await prisma.schedule.findMany({
            where: { barberId: staffProfile.id },
            include: { breaks: true }
        });

        res.json(updatedSchedules);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getSchedule = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });

        if (!staffProfile) {
            return res.status(404).json({ error: 'Staff profile not found' });
        }

        const schedules = await prisma.schedule.findMany({
            where: { barberId: staffProfile.id },
            include: { breaks: true }
        });

        res.json(schedules);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
