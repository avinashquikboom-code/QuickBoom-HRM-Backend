import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import homeRoutes from './routes/homeRoutes';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
// Configure larger limit for base64 profile avatar images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/', homeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
