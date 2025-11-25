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
                paymentMethod: req.body.paymentMethod || 'CASH', // Default to CASH if not provided? Or make it required.
                // Actually, if we are here, we should know the method.
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

        // Check if barber exists and is not deleted
        const barberProfile = await prisma.staffProfile.findUnique({
            where: { id: Number(barberId) }
        });

        if (!barberProfile || barberProfile.deletedAt) {
            return res.status(404).json({ error: 'Barber not found or no longer available' });
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
            },
            include: { breaks: true }
        });

        if (schedules.length === 0) {
            return res.json([]); // No working hours
        }

        // 2. Get Service Duration and Buffer
        const service = await prisma.service.findUnique({ where: { id: Number(serviceId) } });
        if (!service) {
            return res.status(404).json({ error: 'Service not found' });
        }
        const duration = service.duration; // in minutes
        const bufferTime = service.bufferTime || 0; // in minutes

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
                service: { select: { duration: true, bufferTime: true } } // Include bufferTime
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

            // Define slot interval (e.g., 15 minutes)
            const slotGenerationInterval = 15; // minutes

            // The slot must accommodate the service duration.
            // The buffer time is added AFTER the service, so the slot itself is just duration.
            // However, the effective block is duration + buffer.
            // But wait, if I book at 10:00, I occupy 10:00 - 10:30. The buffer is 10:30 - 10:45.
            // So the next slot can start at 10:45.
            // When checking if *this* slot is valid, we need to ensure it doesn't overlap with existing appointments (including their buffers).
            // AND that the appointment + its buffer doesn't overlap with existing appointments.

            while (currentSlot.getTime() + duration * 60000 <= endTime.getTime()) {
                const potentialSlotStart = new Date(currentSlot);
                const potentialSlotEnd = new Date(potentialSlotStart.getTime() + duration * 60000); // End time of the actual service
                const potentialSlotEndWithBuffer = new Date(potentialSlotEnd.getTime() + bufferTime * 60000); // End time including buffer

                // Check if this potential slot overlaps with any existing appointments
                const isBusy = appointments.some(appt => {
                    const apptStart = new Date(appt.startTime);
                    // Existing appointment blocks: duration + its buffer
                    const apptDuration = appt.service?.duration || 0;
                    const apptBuffer = appt.service?.bufferTime || 0;
                    const apptEndWithBuffer = new Date(apptStart.getTime() + (apptDuration + apptBuffer) * 60000);

                    // Overlap condition:
                    // 1. New appointment (with buffer) starts before existing ends (with buffer)
                    // 2. New appointment (with buffer) ends after existing starts
                    // Actually, strictly speaking:
                    // The new appointment's SERVICE time cannot overlap with existing SERVICE time.
                    // AND the new appointment's BUFFER cannot overlap with existing SERVICE time.
                    // AND the existing BUFFER cannot overlap with new SERVICE time.
                    // Buffers CAN overlap with other Buffers? Probably yes, but let's keep it simple: Block the whole chunk.

                    // Simplified: Treat "Appointment + Buffer" as the blocked block.
                    // Overlap: (NewStart < ExistingEndWithBuffer) && (NewEndWithBuffer > ExistingStart)

                    return (potentialSlotStart.getTime() < apptEndWithBuffer.getTime()) && (potentialSlotEndWithBuffer.getTime() > apptStart.getTime());
                });

                // Check if potential slot overlaps with any breaks
                const isBreak = schedule.breaks.some(brk => {
                    const [breakStartHour, breakStartMinute] = brk.startTime.split(':').map(Number);
                    const [breakEndHour, breakEndMinute] = brk.endTime.split(':').map(Number);

                    const breakStart = new Date(selectedDate);
                    breakStart.setHours(breakStartHour, breakStartMinute, 0, 0);

                    const breakEnd = new Date(selectedDate);
                    breakEnd.setHours(breakEndHour, breakEndMinute, 0, 0);

                    // Overlap condition: (SlotStart < BreakEnd) and (SlotEnd > BreakStart)
                    // Should buffer overlap with break? Maybe. Let's say yes, buffer can be during break?
                    // No, usually buffer is for cleaning.
                    // Let's be safe: Service + Buffer cannot overlap with Break.
                    return (potentialSlotStart.getTime() < breakEnd.getTime()) && (potentialSlotEndWithBuffer.getTime() > breakStart.getTime());
                });

                // Also check if the potential slot is in the past
                const now = new Date();
                const isInPast = potentialSlotStart.getTime() < now.getTime();

                if (!isBusy && !isBreak && !isInPast) {
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
        const role = req.user?.role;

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(id) },
            include: { shop: true }
        });

        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Authorization Check
        if (role === 'CUSTOMER') {
            if (appointment.customerId !== userId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            // Customers can only cancel
            if (status !== 'CANCELLED') {
                return res.status(403).json({ error: 'Customers can only cancel appointments' });
            }
        } else if (role === 'STAFF') {
            // Staff can update appointments for their shop (or just their own? Let's say shop)
            // Ideally check if staff belongs to the shop of the appointment
            const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });
            if (!staffProfile || staffProfile.shopId !== appointment.shopId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
        } else if (role === 'ADMIN') {
            // Admin check: owner of the shop
            if (appointment.shop.ownerId !== userId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
        }

        const updatedAppointment = await prisma.appointment.update({
            where: { id: parseInt(id) },
            data: { status },
        });

        res.json(updatedAppointment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const rescheduleAppointment = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { newStartTime } = req.body;
        const userId = req.user?.userId;
        const role = req.user?.role;

        if (!newStartTime) {
            return res.status(400).json({ error: 'New start time is required' });
        }

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(id) },
            include: { service: true }
        });

        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // 1. Permission Check
        if (role === 'CUSTOMER') {
            if (appointment.customerId !== userId) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            // 2. 24h Rule Check for Customers
            const now = new Date();
            const appointmentTime = new Date(appointment.startTime);
            const timeDiff = appointmentTime.getTime() - now.getTime();
            const hoursDiff = timeDiff / (1000 * 3600);

            if (hoursDiff < 24) {
                return res.status(400).json({ error: 'Cannot reschedule appointments less than 24 hours in advance. Please contact the shop.' });
            }
        } else if (role === 'STAFF') {
            // Check if appointment belongs to this barber
            const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });
            if (!staffProfile || appointment.barberId !== staffProfile.id) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
        }
        // Admin can reschedule anything (no check needed)

        // 3. Availability Check for New Time
        const newStart = new Date(newStartTime);
        const duration = appointment.service.duration;
        const newEnd = new Date(newStart.getTime() + duration * 60000);

        // Check if new time is in the past
        if (newStart < new Date()) {
            return res.status(400).json({ error: 'Cannot reschedule to the past' });
        }

        // Check against schedule
        const dayOfWeek = newStart.getDay();
        const schedules = await prisma.schedule.findMany({
            where: {
                barberId: appointment.barberId,
                dayOfWeek: dayOfWeek,
                isAvailable: true
            }
        });

        if (schedules.length === 0) {
            return res.status(400).json({ error: 'Barber is not working on this day' });
        }

        // Check if time is within working hours
        const isWithinWorkingHours = schedules.some(schedule => {
            const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
            const [endHour, endMinute] = schedule.endTime.split(':').map(Number);

            const workStart = new Date(newStart);
            workStart.setHours(startHour, startMinute, 0, 0);

            const workEnd = new Date(newStart);
            workEnd.setHours(endHour, endMinute, 0, 0);

            return newStart >= workStart && newEnd <= workEnd;
        });

        if (!isWithinWorkingHours) {
            return res.status(400).json({ error: 'Selected time is outside working hours' });
        }

        // Check for conflicts with other appointments
        const conflicts = await prisma.appointment.findMany({
            where: {
                barberId: appointment.barberId,
                id: { not: appointment.id }, // Exclude current appointment
                status: { not: 'CANCELLED' },
                AND: [
                    { startTime: { lt: newEnd } },
                    {
                        startTime: {
                            // We need to check end time of existing appointment
                            // But Prisma doesn't store end time directly.
                            // We can use raw query or fetch and filter.
                            // For simplicity, let's fetch potential conflicts based on start time proximity
                            // and filter in JS, OR assume max service duration.
                            // Better approach:
                            // Overlap: (StartA < EndB) and (EndA > StartB)
                            // We can't easily express EndB in Prisma where clause without a computed column.
                            // So let's fetch appointments on that day and filter.
                        }
                    }
                ]
            },
            include: { service: true }
        });

        // Refined conflict check
        // Fetch all appointments for that barber on that day
        const startOfDay = new Date(newStart); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(newStart); endOfDay.setHours(23, 59, 59, 999);

        const dayAppointments = await prisma.appointment.findMany({
            where: {
                barberId: appointment.barberId,
                id: { not: appointment.id },
                status: { not: 'CANCELLED' },
                startTime: { gte: startOfDay, lte: endOfDay }
            },
            include: { service: true }
        });

        const hasConflict = dayAppointments.some(appt => {
            const apptStart = new Date(appt.startTime);
            const apptEnd = new Date(apptStart.getTime() + appt.service.duration * 60000);
            return (newStart < apptEnd && newEnd > apptStart);
        });

        if (hasConflict) {
            return res.status(400).json({ error: 'Selected time slot is not available' });
        }

        // 4. Update Appointment
        const updatedAppointment = await prisma.appointment.update({
            where: { id: parseInt(id) },
            data: { startTime: newStart }
        });

        res.json(updatedAppointment);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
