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
const postsRoutes = require('./routes/posts');
const connectionsRoutes = require('./routes/connections');
const usersRoutes = require('./routes/users');
require('./config/passport');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: '*'
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to API routes
app.use('/api/', limiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs for auth
  message: 'Too many authentication attempts, please try again later.'
});

app.use('/api/auth', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Passport middleware
app.use(passport.initialize());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/users', usersRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Blog Platform API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/signup': 'Register a new user',
        'POST /api/auth/login': 'Login user',
        'POST /api/auth/refresh': 'Refresh access token',
        'POST /api/auth/logout': 'Logout user',
        'GET /api/auth/google': 'Google OAuth login',
        'GET /api/auth/me': 'Get current user profile'
      },
      posts: {
        'POST /api/posts': 'Create a new post',
        'GET /api/posts/feed': 'Get posts from connections',
        'GET /api/posts/:id': 'Get specific post',
        'PUT /api/posts/:id': 'Update post',
        'DELETE /api/posts/:id': 'Delete post',
        'POST /api/posts/:id/like': 'Like/unlike post',
        'POST /api/posts/:id/comment': 'Add comment to post',
        'GET /api/posts/user/:userId': 'Get posts by user'
      },
      connections: {
        'POST /api/connections/request': 'Send connection request',
        'GET /api/connections/requests': 'Get incoming requests',
        'GET /api/connections/sent': 'Get sent requests',
        'PUT /api/connections/:id/accept': 'Accept request',
        'PUT /api/connections/:id/decline': 'Decline request',
        'DELETE /api/connections/:id': 'Remove connection',
        'GET /api/connections': 'Get all connections',
        'GET /api/connections/status/:userId': 'Get connection status'
      },
      users: {
        'GET /api/users/search': 'Search for users',
        'GET /api/users/suggestions': 'Get user suggestions',
        'GET /api/users/:id': 'Get user profile',
        'GET /api/users/:id/posts': 'Get user posts',
        'GET /api/users/trending/tags': 'Get trending tags',
        'GET /api/users/stats/overview': 'Get platform stats'
      }
    },
    documentation: 'Visit /api for endpoint details'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    availableEndpoints: '/api'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error occurred:', err.stack);
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      error: 'Validation Error', 
      details: err.message 
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({ 
      error: 'Invalid ID format' 
    });
  }
  
  if (err.code === 11000) {
    return res.status(409).json({ 
      error: 'Duplicate entry',
      field: Object.keys(err.keyPattern)[0]
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
  });
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
    console.log(`📚 API Documentation: http://localhost:${PORT}/api`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
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

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.error('Unhandled Promise Rejection:', err.message);
  console.error('Shutting down server...');
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error('Shutting down server...');
  process.exit(1);
});