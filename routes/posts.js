const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/post');
const User = require('../models/user');
const Connection = require('../models/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const validatePost = [
  body('content')
    .trim()
    .isLength({ min: 10, max: 10000 })
    .withMessage('Content must be between 10 and 10000 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array')
    .custom((tags) => {
      if (tags && tags.length > 10) {
        throw new Error('Maximum 10 tags allowed');
      }
      return true;
    })
];

const validateComment = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Comment must be between 1 and 1000 characters')
];
const handleError = (res, error, message = 'Internal server error') => {
  console.error(`${message}:`, error);
  res.status(500).json({ 
    error: message,
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
};
const handleValidationError = (res, errors) => {
  return res.status(400).json({
    error: 'Validation failed',
    details: errors.array()
  });
};

// POST /api/posts - Create a new post
router.post('/', requireAuth, validatePost, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return handleValidationError(res, errors);
    }

    const { content, tags = [], isPublished = true } = req.body;

    const post = new Post({
      content,
      author: req.user._id,
      tags: tags.map(tag => tag.toLowerCase().trim()),
      isPublished
    });

    await post.save();
    await post.populate('author', 'firstName lastName email');

    res.status(201).json({
      message: 'Post created successfully',
      post
    });
  } catch (error) {
    handleError(res, error, 'Create post error');
  }
});

// GET /api/posts/discover - Public posts discovery 
router.get('/discover', async (req, res) => {
  console.log('=== DISCOVER ROUTE CALLED ===');
  console.log('Query params:', req.query);
  console.log('Client IP:', req.ip);
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Cap at 50
    const skip = (page - 1) * limit;
    const sortBy = req.query.sort || 'latest';

    console.log('Pagination params:', { page, limit, skip, sortBy });

    let sortObj = { createdAt: -1 }; 
    switch (sortBy) {
      case 'oldest':
        sortObj = { createdAt: 1 };
        break;
      case 'popular':
        sortObj = { 'likes.length': -1, createdAt: -1 };
        break;
      case 'trending':
        sortObj = { createdAt: -1 }; 
        break;
      default:
        sortObj = { createdAt: -1 };
    }

    console.log('Sort object:', sortObj);
    const totalPosts = await Post.countDocuments({ isPublished: true });
    console.log('Total published posts:', totalPosts);

    if (totalPosts === 0) {
      return res.json({
        posts: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalPosts: 0,
          hasNext: false,
          hasPrev: false
        },
        sortBy,
        message: 'No published posts found'
      });
    }
    const posts = await Post.find({ isPublished: true })
      .populate('author', 'firstName lastName email')
      .populate('comments.user', 'firstName lastName')
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();

    console.log('Posts fetched successfully, count:', posts.length);

    const postsWithStats = posts.map(post => ({
      ...post,
      likesCount: post.likes ? post.likes.length : 0,
      commentsCount: post.comments ? post.comments.length : 0,
      isLiked: false 
    }));

    const response = {
      posts: postsWithStats,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        totalPosts,
        hasNext: page < Math.ceil(totalPosts / limit),
        hasPrev: page > 1
      },
      sortBy,
      filters: {
        available: ['latest', 'oldest', 'popular', 'trending'],
        current: sortBy
      }
    };

    console.log('Response prepared successfully');
    res.json(response);

  } catch (error) {
    console.error('=== DISCOVER ROUTE ERROR ===');
    console.error('Error details:', error);
    handleError(res, error, 'Failed to fetch posts');
  }
});

// GET /api/posts/discover-debug
router.get('/discover-debug', async (req, res) => {
  console.log('=== DEBUG ROUTE CALLED ===');
  console.log('Client IP:', req.ip);
  console.log('Headers:', req.headers);
  
  try {
    const dbTest = await mongoose.connection.db.admin().ping();
    console.log('Database ping successful:', dbTest);

    const totalCount = await Post.countDocuments({});
    const publishedCount = await Post.countDocuments({ isPublished: true });
    
    const samplePosts = await Post.find({}).limit(3).lean();
    
    const indexes = await Post.collection.getIndexes();
    
    const debugInfo = {
      success: true,
      timestamp: new Date().toISOString(),
      clientIP: req.ip,
      database: {
        connected: mongoose.connection.readyState === 1,
        totalPosts: totalCount,
        publishedPosts: publishedCount
      },
      sampleData: samplePosts.map(post => ({
        id: post._id,
        isPublished: post.isPublished,
        hasAuthor: !!post.author,
        createdAt: post.createdAt
      })),
      indexes: Object.keys(indexes),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        trustProxy: req.app.get('trust proxy')
      }
    };

    res.json(debugInfo);

  } catch (error) {
    console.error('Debug route error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      clientIP: req.ip
    });
  }
});

// GET /api/posts/feed - Get posts from connections
router.get('/feed', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const connections = await Connection.find({
      $or: [
        { requester: req.user._id, status: 'accepted' },
        { recipient: req.user._id, status: 'accepted' }
      ]
    });
    const connectedUserIds = connections.map(conn => 
      conn.requester.equals(req.user._id) ? conn.recipient : conn.requester
    );
    connectedUserIds.push(req.user._id);
    const posts = await Post.find({
      author: { $in: connectedUserIds },
      isPublished: true
    })
    .populate('author', 'firstName lastName email')
    .populate('comments.user', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
    const totalPosts = await Post.countDocuments({
      author: { $in: connectedUserIds },
      isPublished: true
    });

    res.json({
      posts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        totalPosts,
        hasNext: page < Math.ceil(totalPosts / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    handleError(res, error, 'Get feed error');
  }
});
router.get('/trending-tags', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const trendingTags = await Post.aggregate([
      { $match: { isPublished: true } },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          recentPosts: { $sum: { $cond: [
            { $gte: ['$createdAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
            1,
            0
          ] } }
        }
      },
      { $sort: { recentPosts: -1, count: -1 } },
      { $limit: limit },
      {
        $project: {
          tag: '$_id',
          totalPosts: '$count',
          recentPosts: '$recentPosts',
          _id: 0
        }
      }
    ]);

    res.json(trendingTags);
  } catch (error) {
    handleError(res, error, 'Get trending tags error');
  }
});
router.get('/user/:userId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;

    const posts = await Post.find({
      author: req.params.userId,
      isPublished: true
    })
    .populate('author', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const totalPosts = await Post.countDocuments({
      author: req.params.userId,
      isPublished: true
    });

    res.json({
      posts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        totalPosts,
        hasNext: page < Math.ceil(totalPosts / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    handleError(res, error, 'Get user posts error');
  }
});
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'firstName lastName email')
      .populate('comments.user', 'firstName lastName');

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(post);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    handleError(res, error, 'Get post error');
  }
});

// PUT /api/posts/:id 
router.put('/:id', requireAuth, validatePost, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return handleValidationError(res, errors);
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (!post.author.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to update this post' });
    }

    const { content, tags = [], isPublished } = req.body;

    post.content = content;
    post.tags = tags.map(tag => tag.toLowerCase().trim());
    if (isPublished !== undefined) post.isPublished = isPublished;

    await post.save();
    await post.populate('author', 'firstName lastName email');

    res.json({
      message: 'Post updated successfully',
      post
    });
  } catch (error) {
    handleError(res, error, 'Update post error');
  }
});

// DELETE /api/posts/:id 
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (!post.author.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    handleError(res, error, 'Delete post error');
  }
});

// POST /api/posts/:id/like 
router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (!post.likes) {
      post.likes = [];
    }

    const existingLike = post.likes.find(like => like.user.equals(req.user._id));

    if (existingLike) {
      post.likes = post.likes.filter(like => !like.user.equals(req.user._id));
      await post.save();
      res.json({ message: 'Post unliked', liked: false, likesCount: post.likes.length });
    } else {
      post.likes.push({ user: req.user._id });
      await post.save();
      res.json({ message: 'Post liked', liked: true, likesCount: post.likes.length });
    }
  } catch (error) {
    handleError(res, error, 'Like post error');
  }
});

// POST /api/posts/:id/comment
router.post('/:id/comment', requireAuth, validateComment, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return handleValidationError(res, errors);
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { content } = req.body;
    if (!post.comments) {
      post.comments = [];
    }

    post.comments.push({
      user: req.user._id,
      content
    });

    await post.save();
    await post.populate('comments.user', 'firstName lastName');

    const newComment = post.comments[post.comments.length - 1];

    res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment
    });
  } catch (error) {
    handleError(res, error, 'Add comment error');
  }
});

module.exports = router;