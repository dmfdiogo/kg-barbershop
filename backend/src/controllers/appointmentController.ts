import { Request, Response } from 'express';
import { PrismaClient, AppointmentStatus } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

export const createAppointment = async (req: AuthRequest, res: Response) => {
    try {
        const { shopId, barberId, serviceId, startTime } = req.body;
        const customerId = req.user?.userId;

        if (!customerId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Basic validation: Check if barber is available (simplified for MVP)
        // In a real app, we'd check against the schedule and existing appointments

        const appointment = await prisma.appointment.create({
            data: {
                shopId,
                customerId,
                barberId,
                serviceId,
                startTime: new Date(startTime),
                status: AppointmentStatus.PENDING,
            },
        });

        res.status(201).json(appointment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAppointments = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const role = req.user?.role;

        let whereClause = {};
        if (role === 'CUSTOMER') {
            whereClause = { customerId: userId };
        } else if (role === 'STAFF') {
            // Find staff profile to get ID
            const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });
            if (staffProfile) {
                whereClause = { barberId: staffProfile.id };
            }
        } else if (role === 'ADMIN') {
            // Admin sees all appointments for their shops
            const shops = await prisma.shop.findMany({ where: { ownerId: userId } });
            const shopIds = shops.map((s: { id: number }) => s.id);
            whereClause = { shopId: { in: shopIds } };
        }

        const appointments = await prisma.appointment.findMany({
            where: whereClause,
            include: {
                shop: { select: { name: true } },
                customer: { select: { name: true, email: true } },
                barber: { include: { user: { select: { name: true } } } },
                service: { select: { name: true, duration: true, price: true } },
            },
            orderBy: { startTime: 'desc' },
        });

        res.json(appointments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAvailability = async (req: AuthRequest, res: Response) => {
    try {
        const { barberId, date, serviceId } = req.query;

        if (!barberId || !date || !serviceId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Parse date as local time to ensure getDay() returns the correct day relative to the server's timezone
        const selectedDate = new Date(`${date}T00:00:00`);
        const dayOfWeek = selectedDate.getDay();

        // 1. Get Barber's Schedule for that day
        const schedules = await prisma.schedule.findMany({
            where: {
                barberId: Number(barberId),
                dayOfWeek: dayOfWeek,
                isAvailable: true
            }
        });

        if (schedules.length === 0) {
            return res.json([]); // No working hours
        }

        // 2. Get Service Duration
        const service = await prisma.service.findUnique({ where: { id: Number(serviceId) } });
        if (!service) {
            return res.status(404).json({ error: 'Service not found' });
        }
        const duration = service.duration; // in minutes

        // 3. Get Existing Appointments
        // Start of day
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        // End of day
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        const appointments = await prisma.appointment.findMany({
            where: {
                barberId: Number(barberId),
                startTime: {
                    gte: startOfDay,
                    lte: endOfDay
                },
                status: {
                    not: 'CANCELLED'
                }
            },
            include: {
                service: { select: { duration: true } } // Include service to get duration for existing appointments
            }
        });

        // 4. Generate Slots
        const slots: string[] = [];

        for (const schedule of schedules) {
            // Parse start/end times (e.g., "09:00")
            const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
            const [endHour, endMinute] = schedule.endTime.split(':').map(Number);

            let currentSlot = new Date(selectedDate);
            currentSlot.setHours(startHour, startMinute, 0, 0);

            const endTime = new Date(selectedDate);
            endTime.setHours(endHour, endMinute, 0, 0);

            // Define slot interval (e.g., 15 minutes, or service duration if it's the smallest unit)
            // For simplicity, let's use a fixed interval for generating potential slots, e.g., 15 minutes
            const slotGenerationInterval = 15; // minutes

            while (currentSlot.getTime() + duration * 60000 <= endTime.getTime()) {
                const potentialSlotStart = new Date(currentSlot);
                const potentialSlotEnd = new Date(potentialSlotStart.getTime() + duration * 60000); // End time of the potential appointment

                // Check if this potential slot overlaps with any existing appointments
                const isBusy = appointments.some(appt => {
                    const apptStart = new Date(appt.startTime);
                    const apptEnd = new Date(apptStart.getTime() + (appt.service?.duration || 0) * 60000);

                    // Overlap condition: (StartA < EndB) and (EndA > StartB)
                    return (potentialSlotStart.getTime() < apptEnd.getTime()) && (potentialSlotEnd.getTime() > apptStart.getTime());
                });

                // Also check if the potential slot is in the past
                const now = new Date();
                const isInPast = potentialSlotStart.getTime() < now.getTime();

                if (!isBusy && !isInPast) {
                    slots.push(potentialSlotStart.toISOString());
                }

                // Move to the next potential slot
                currentSlot = new Date(currentSlot.getTime() + slotGenerationInterval * 60000);
            }
        }

        res.json(slots);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateAppointmentStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user?.userId;

        // TODO: Add authorization check (only admin/staff/owner of appointment)

        const appointment = await prisma.appointment.update({
            where: { id: parseInt(id) },
            data: { status },
        });

        res.json(appointment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
