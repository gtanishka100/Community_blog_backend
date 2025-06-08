const express = require('express');
const { body, validationResult } = require('express-validator');
const Post = require('../models/post');
const User = require('../models/user');
const Connection = require('../models/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const validatePost = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('content')
    .trim()
    .isLength({ min: 10, max: 10000 })
    .withMessage('Content must be between 10 and 10000 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array')
    .custom((tags) => {
      if (tags.length > 10) {
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

// POST /api/posts - Create a new post
router.post('/', requireAuth, validatePost, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { title, content, tags = [], isPublished = true } = req.body;

    const post = new Post({
      title,
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
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/posts/feed - Get posts from connections
router.get('/feed', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get user's connections
    const connections = await Connection.find({
      $or: [
        { requester: req.user._id, status: 'accepted' },
        { recipient: req.user._id, status: 'accepted' }
      ]
    });

    // Extract connected user IDs
    const connectedUserIds = connections.map(conn => 
      conn.requester.equals(req.user._id) ? conn.recipient : conn.requester
    );

    // Include user's own posts
    connectedUserIds.push(req.user._id);

    // Get posts from connected users
    const posts = await Post.find({
      author: { $in: connectedUserIds },
      isPublished: true
    })
    .populate('author', 'firstName lastName email')
    .populate('comments.user', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    // Get total count for pagination
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
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/posts/:id - Get a specific post
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
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/posts/:id - Update a post
router.put('/:id', requireAuth, validatePost, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author
    if (!post.author.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to update this post' });
    }

    const { title, content, tags = [], isPublished } = req.body;

    post.title = title;
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
    console.error('Update post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/posts/:id - Delete a post
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is the author
    if (!post.author.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/posts/:id/like - Like/Unlike a post
router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Initialize likes array if it doesn't exist
    if (!post.likes) {
      post.likes = [];
    }

    const existingLike = post.likes.find(like => like.user.equals(req.user._id));

    if (existingLike) {
      // Unlike the post
      post.likes = post.likes.filter(like => !like.user.equals(req.user._id));
      await post.save();
      res.json({ message: 'Post unliked', liked: false, likesCount: post.likes.length });
    } else {
      // Like the post
      post.likes.push({ user: req.user._id });
      await post.save();
      res.json({ message: 'Post liked', liked: true, likesCount: post.likes.length });
    }
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/posts/:id/comment - Add a comment to a post
router.post('/:id/comment', requireAuth, validateComment, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { content } = req.body;

    // Initialize comments array if it doesn't exist
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
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simple GET /api/posts/discover - Simplified version for debugging
router.get('/discover', async (req, res) => {
  console.log('=== DISCOVER ROUTE CALLED ===');
  console.log('Query params:', req.query);
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    // Start with the simplest possible query
    console.log('Step 1: Checking database connection...');
    const postCount = await Post.countDocuments({});
    console.log('Total posts in database:', postCount);
    
    console.log('Step 2: Checking published posts...');
    const publishedCount = await Post.countDocuments({ isPublished: true });
    console.log('Published posts count:', publishedCount);
    
    if (publishedCount === 0) {
      console.log('No published posts found');
      return res.json({
        posts: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalPosts: 0,
          hasNext: false,
          hasPrev: false
        },
        sortBy: 'latest',
        message: 'No published posts found'
      });
    }
    
    console.log('Step 3: Fetching posts with basic query...');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    console.log('Pagination params:', { page, limit, skip });
    
    // Use the simplest query possible
    const posts = await Post.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean for better performance
    
    console.log('Step 4: Posts fetched successfully, count:', posts.length);
    
    // Try to populate author separately
    console.log('Step 5: Attempting to populate authors...');
    let populatedPosts = [];
    
    try {
      populatedPosts = await Post.populate(posts, {
        path: 'author',
        select: 'firstName lastName email'
      });
      console.log('Author population successful');
    } catch (populateError) {
      console.error('Author population failed:', populateError.message);
      // Return posts without author population if it fails
      populatedPosts = posts;
    }
    
    console.log('Step 6: Preparing response...');
    const response = {
      posts: populatedPosts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(publishedCount / limit),
        totalPosts: publishedCount,
        hasNext: page < Math.ceil(publishedCount / limit),
        hasPrev: page > 1
      },
      sortBy: req.query.sort || 'latest',
      debug: {
        totalInDb: postCount,
        publishedCount: publishedCount,
        returnedCount: populatedPosts.length,
        timestamp: new Date().toISOString()
      }
    };
    
    console.log('Step 7: Sending response...');
    console.log('Response summary:', {
      postsCount: response.posts.length,
      totalPages: response.pagination.totalPages,
      currentPage: response.pagination.currentPage
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('=== DISCOVER ROUTE ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('==============================');
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString(),
      debug: true
    });
  }
});

// Debug route for basic testing
router.get('/discover-debug', async (req, res) => {
  console.log('=== DEBUG ROUTE CALLED ===');
  
  try {
    // Test 1: Basic database connection
    console.log('Test 1: Database connection...');
    const dbStats = await Post.collection.stats();
    console.log('Collection stats:', { count: dbStats.count, size: dbStats.size });
    
    // Test 2: Simple count
    console.log('Test 2: Simple count...');
    const totalCount = await Post.countDocuments({});
    const publishedCount = await Post.countDocuments({ isPublished: true });
    console.log('Counts - Total:', totalCount, 'Published:', publishedCount);
    
    // Test 3: Simple find
    console.log('Test 3: Simple find...');
    const samplePosts = await Post.find({}).limit(2).lean();
    console.log('Sample posts structure:', samplePosts.map(p => ({
      id: p._id,
      title: p.title,
      isPublished: p.isPublished,
      hasAuthor: !!p.author,
      hasLikes: !!p.likes,
      hasComments: !!p.comments,
      createdAt: p.createdAt
    })));
    
    // Test 4: Published posts only
    console.log('Test 4: Published posts...');
    const publishedPosts = await Post.find({ isPublished: true }).limit(2).lean();
    console.log('Published posts found:', publishedPosts.length);
    
    res.json({
      success: true,
      tests: {
        databaseConnection: 'OK',
        totalPosts: totalCount,
        publishedPosts: publishedCount,
        sampleStructure: samplePosts.length > 0 ? Object.keys(samplePosts[0]) : [],
        publishedFound: publishedPosts.length
      },
      message: 'All basic tests passed'
    });
    
  } catch (error) {
    console.error('Debug route error:', error);
    res.status(500).json({
      error: 'Debug failed',
      message: error.message,
      stack: error.stack
    });
  }
});

// GET /api/posts/trending-tags - Get trending hashtags/tags
router.get('/trending-tags', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    // Get trending tags using aggregation
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
    console.error('Get trending tags error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/posts/user/:userId - Get posts by a specific user
router.get('/user/:userId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
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
    console.error('Get user posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;