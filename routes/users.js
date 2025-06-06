const express = require('express');
const { query, validationResult } = require('express-validator');
const User = require('../models/user');
const Post = require('../models/post');
const Connection = require('../models/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const validateSearch = [
  query('q')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters')
];

// GET /api/users/search - Search for users
router.get('/search', requireAuth, validateSearch, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { q, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Create search regex
    const searchRegex = new RegExp(q, 'i');

    // Search in firstName, lastName, and email
    const users = await User.find({
      $and: [
        { _id: { $ne: req.user._id } }, // Exclude current user
        {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex },
            {
              $expr: {
                $regexMatch: {
                  input: { $concat: ['$firstName', ' ', '$lastName'] },
                  regex: q,
                  options: 'i'
                }
              }
            }
          ]
        }
      ]
    })
    .select('firstName lastName email createdAt')
    .skip(skip)
    .limit(limitNum)
    .sort({ firstName: 1, lastName: 1 });

    // Get total count for pagination
    const totalUsers = await User.countDocuments({
      $and: [
        { _id: { $ne: req.user._id } },
        {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex },
            {
              $expr: {
                $regexMatch: {
                  input: { $concat: ['$firstName', ' ', '$lastName'] },
                  regex: q,
                  options: 'i'
                }
              }
            }
          ]
        }
      ]
    });

    // Get connection status for each user
    const userIds = users.map(user => user._id);
    const connections = await Connection.find({
      $or: [
        { requester: req.user._id, recipient: { $in: userIds } },
        { requester: { $in: userIds }, recipient: req.user._id }
      ]
    });

    // Create connection status map
    const connectionMap = {};
    connections.forEach(conn => {
      const otherUserId = conn.requester.equals(req.user._id) 
        ? conn.recipient.toString() 
        : conn.requester.toString();
      
      connectionMap[otherUserId] = {
        status: conn.status,
        connectionId: conn._id,
        isRequester: conn.requester.equals(req.user._id)
      };
    });

    // Add connection status to users
    const usersWithConnectionStatus = users.map(user => ({
      ...user.toObject(),
      connection: connectionMap[user._id.toString()] || { status: 'none' }
    }));

    res.json({
      users: usersWithConnectionStatus,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalUsers / limitNum),
        totalUsers,
        hasNext: pageNum < Math.ceil(totalUsers / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/suggestions - Get user suggestions (users with no connection)
router.get('/suggestions', requireAuth, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit);

    // Get all existing connections
    const existingConnections = await Connection.find({
      $or: [
        { requester: req.user._id },
        { recipient: req.user._id }
      ]
    });

    // Extract user IDs that are already connected or have pending requests
    const connectedUserIds = existingConnections.map(conn => 
      conn.requester.equals(req.user._id) ? conn.recipient : conn.requester
    );
    
    
    // Add current user ID to exclude
    connectedUserIds.push(req.user._id);

    // Find users not in the connected list
    const suggestions = await User.find({
      _id: { $nin: connectedUserIds }
    })
    .select('firstName lastName email createdAt')
    .limit(limitNum)
    .sort({ createdAt: -1 }); // Newest users first

    res.json(suggestions);
  } catch (error) {
    console.error('Get user suggestions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id - Get user profile
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('firstName lastName email createdAt isVerified');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's post count
    const postCount = await Post.countDocuments({
      author: req.params.id,
      isPublished: true
    });

    // Get connection count
    const connectionCount = await Connection.countDocuments({
      $or: [
        { requester: req.params.id, status: 'accepted' },
        { recipient: req.params.id, status: 'accepted' }
      ]
    });

    // If current user is authenticated, get connection status
    let connectionStatus = null;
    if (req.user) {
      const connection = await Connection.findOne({
        $or: [
          { requester: req.user._id, recipient: req.params.id },
          { requester: req.params.id, recipient: req.user._id }
        ]
      });

      if (connection) {
        connectionStatus = {
          status: connection.status,
          connectionId: connection._id,
          isRequester: connection.requester.equals(req.user._id)
        };
      } else {
        connectionStatus = { status: 'none' };
      }
    }

    const userProfile = {
      ...user.toObject(),
      stats: {
        postCount,
        connectionCount
      }
    };

    if (connectionStatus) {
      userProfile.connection = connectionStatus;
    }

    res.json(userProfile);
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/posts - Get user's posts
router.get('/:id/posts', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const posts = await Post.find({
      author: req.params.id,
      isPublished: true
    })
    .populate('author', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

    const totalPosts = await Post.countDocuments({
      author: req.params.id,
      isPublished: true
    });

    res.json({
      posts,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalPosts / limitNum),
        totalPosts,
        hasNext: pageNum < Math.ceil(totalPosts / limitNum),
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/trending/tags - Get trending tags
router.get('/trending/tags', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit);

    // Get trending tags from the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trendingTags = await Post.aggregate([
      {
        $match: {
          isPublished: true,
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $unwind: '$tags'
      },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: limitNum
      },
      {
        $project: {
          tag: '$_id',
          count: 1,
          _id: 0
        }
      }
    ]);

    res.json(trendingTags);
  } catch (error) {
    console.error('Get trending tags error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/stats/overview - Get platform overview stats
router.get('/stats/overview', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalPosts = await Post.countDocuments({ isPublished: true });
    const totalConnections = await Connection.countDocuments({ status: 'accepted' });

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentUsers = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    const recentPosts = await Post.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
      isPublished: true
    });

    res.json({
      totalUsers,
      totalPosts,
      totalConnections,
      recentActivity: {
        newUsers: recentUsers,
        newPosts: recentPosts
      }
    });
  } catch (error) {
    console.error('Get overview stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;