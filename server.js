const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
require('dotenv').config();

// DEBUG: Check if environment variables are loaded
console.log('Environment check:');
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
console.log('MONGODB_URI starts with mongodb:', process.env.MONGODB_URI?.startsWith('mongodb'));
if (process.env.MONGODB_URI) {
  // Show first part of URI for debugging (hide credentials)
  const uriParts = process.env.MONGODB_URI.split('@');
  console.log('MongoDB cluster:', uriParts[1] || 'URI format issue');
}

// Import routes and config
const authRoutes = require('./routes/auth');
require('./config/passport');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: '*'
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/auth', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Passport middleware
app.use(passport.initialize());

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Connect to MongoDB
console.log('Attempting MongoDB connection...');
mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB successfully!');
  
  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
})
.catch((error) => {
  console.error('❌ Database connection error:', error.message);
  console.error('\nTroubleshooting steps:');
  console.error('1. Check your .env file exists in the project root');
  console.error('2. Verify MONGODB_URI format: mongodb+srv://username:password@cluster.mongodb.net/database');
  console.error('3. Ensure database user exists with correct credentials');
  console.error('4. Check IP whitelist in MongoDB Atlas');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});