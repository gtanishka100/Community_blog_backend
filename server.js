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
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

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
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Community Blog Platform API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/signup': 'Create new user account',
        'POST /api/auth/login': 'Login user',
        'POST /api/auth/refresh': 'Refresh access token',
        'POST /api/auth/logout': 'Logout user',
        'GET /api/auth/google': 'Google OAuth login',
        'GET /api/auth/me': 'Get current user info (protected)'
      },
      posts: {
        'POST /api/posts': 'Create new post (protected)',
        'GET /api/posts/feed': 'Get posts from connections (protected)',
        'GET /api/posts/discover': 'Get discovery feed (public)',
        'GET /api/posts/trending-tags': 'Get trending tags',
        'GET /api/posts/:id': 'Get specific post',
        'PUT /api/posts/:id': 'Update post (protected)',
        'DELETE /api/posts/:id': 'Delete post (protected)',
        'POST /api/posts/:id/like': 'Like/unlike post (protected)',
        'POST /api/posts/:id/comment': 'Add comment to post (protected)',
        'GET /api/posts/user/:userId': 'Get posts by user'
      },
      connections: {
        'POST /api/connections/request': 'Send connection request (protected)',
        'GET /api/connections/requests': 'Get incoming requests (protected)',
        'GET /api/connections/sent': 'Get sent requests (protected)',
        'PUT /api/connections/:id/accept': 'Accept connection (protected)',
        'PUT /api/connections/:id/decline': 'Decline connection (protected)',
        'DELETE /api/connections/:id': 'Remove connection (protected)',
        'GET /api/connections': 'Get all connections (protected)',
        'GET /api/connections/status/:userId': 'Get connection status (protected)'
      },
      users: {
        'GET /api/users/search': 'Search users (protected)',
        'GET /api/users/suggestions': 'Get user suggestions (protected)',
        'GET /api/users/:id': 'Get user profile'
      }
    }
  });
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
    console.log(`📚 API documentation available at http://localhost:${PORT}/api`);
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