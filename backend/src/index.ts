import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 5100;

app.use(cors());

// Webhook route must be registered BEFORE express.json() to get raw body
import { handleStripeWebhook } from './controllers/webhookController';
app.post('/api/webhooks', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json());

import authRoutes from './routes/authRoutes';
import shopRoutes from './routes/shopRoutes';
import serviceRoutes from './routes/serviceRoutes';
import appointmentRoutes from './routes/appointmentRoutes';
import scheduleRoutes from './routes/scheduleRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import staffRoutes from './routes/staffRoutes';
import globalServiceRoutes from './routes/globalServiceRoutes';
import paymentRoutes from './routes/paymentRoutes';

app.use('/api/auth', authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/global-services', globalServiceRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/', (req, res) => {
    res.send('Barber Shop API is running');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
