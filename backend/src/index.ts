import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 5100;

app.use(cors());
app.use(express.json());

import authRoutes from './routes/authRoutes';
import shopRoutes from './routes/shopRoutes';
import serviceRoutes from './routes/serviceRoutes';
import appointmentRoutes from './routes/appointmentRoutes';
import scheduleRoutes from './routes/scheduleRoutes';
import analyticsRoutes from './routes/analyticsRoutes';

app.use('/api/auth', authRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/', (req, res) => {
    res.send('Barber Shop API is running');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
