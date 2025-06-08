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

// GET /api/posts/discover - Get random/trending posts for discovery feed (like Instagram)
router.get('/discover', async (req, res) => {
  try {
    console.log('Discover route called with query:', req.query);
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const sortBy = req.query.sort || 'mixed'; // 'latest', 'popular', 'random', 'mixed'

    console.log('Parameters:', { page, limit, skip, sortBy });

    let sortOptions = {};
    let aggregationPipeline = [];

    // Base match condition
    const matchCondition = { isPublished: true };

    switch (sortBy) {
      case 'latest':
        sortOptions = { createdAt: -1 };
        console.log('Using latest sort');
        break;
      
      case 'popular':
        console.log('Using popular sort');
        // Sort by engagement score (likes + comments count)
        aggregationPipeline = [
          { $match: matchCondition },
          {
            $addFields: {
              engagementScore: {
                $add: [
                  { $size: { $ifNull: ["$likes", []] } }, // Handle null likes array
                  { $multiply: [{ $size: { $ifNull: ["$comments", []] } }, 2] } // Handle null comments array
                ]
              }
            }
          },
          { $sort: { engagementScore: -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit }
        ];
        break;
      
      case 'random':
        console.log('Using random sort');
        aggregationPipeline = [
          { $match: matchCondition },
          { $sample: { size: Math.min(limit * 2, 100) } }, // Limit sample size to prevent memory issues
          { $skip: skip },
          { $limit: limit }
        ];
        break;
      
      case 'mixed':
      default:
        console.log('Using mixed sort');
        // Mixed algorithm: combine recent and popular posts
        const currentDate = new Date();
        aggregationPipeline = [
          { $match: matchCondition },
          {
            $addFields: {
              // Calculate a mixed score based on recency and engagement
              daysSinceCreated: {
                $divide: [
                  { $subtract: [currentDate, "$createdAt"] },
                  1000 * 60 * 60 * 24 // Convert to days
                ]
              },
              engagementCount: {
                $add: [
                  { $size: { $ifNull: ["$likes", []] } },
                  { $multiply: [{ $size: { $ifNull: ["$comments", []] } }, 1.5] }
                ]
              }
            }
          },
          {
            $addFields: {
              mixedScore: {
                $add: [
                  // Recency score (newer posts get higher score, max 30 days)
                  { $max: [0, { $subtract: [30, "$daysSinceCreated"] }] },
                  // Engagement score with weight
                  { $multiply: ["$engagementCount", 2] }
                ]
              }
            }
          },
          { $sort: { mixedScore: -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit }
        ];
        break;
    }

    let posts;
    let totalPosts;

    if (aggregationPipeline.length > 0) {
      console.log('Using aggregation pipeline');
      // Use aggregation pipeline with improved population
      const aggregationWithPopulate = [
        ...aggregationPipeline,
        {
          $lookup: {
            from: 'users',
            localField: 'author',
            foreignField: '_id',
            as: 'author',
            pipeline: [{ $project: { firstName: 1, lastName: 1, email: 1 } }]
          }
        },
        {
          $addFields: {
            author: { $arrayElemAt: ['$author', 0] }
          }
        },
        // Ensure arrays exist
        {
          $addFields: {
            comments: { $ifNull: ['$comments', []] },
            likes: { $ifNull: ['$likes', []] }
          }
        }
      ];

      posts = await Post.aggregate(aggregationWithPopulate);
      console.log('Aggregation returned posts:', posts.length);
      
      // Populate comment users separately for better performance
      if (posts.length > 0) {
        await Post.populate(posts, {
          path: 'comments.user',
          select: 'firstName lastName'
        });
      }
      
      // Get total count for pagination
      totalPosts = await Post.countDocuments(matchCondition);
    } else {
      console.log('Using regular find');
      // Use regular find with sort
      posts = await Post.find(matchCondition)
        .populate('author', 'firstName lastName email')
        .populate('comments.user', 'firstName lastName')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(); // Use lean() for better performance

      totalPosts = await Post.countDocuments(matchCondition);
    }

    console.log('Final posts count:', posts.length);
    console.log('Total posts in DB:', totalPosts);

    res.json({
      posts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        totalPosts,
        hasNext: page < Math.ceil(totalPosts / limit),
        hasPrev: page > 1
      },
      sortBy
    });
  } catch (error) {
    console.error('Get discover feed error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
});

// Debug route for testing (remove in production)
router.get('/discover-debug', async (req, res) => {
  try {
    console.log('Debug route called');
    
    // Test basic query first
    const postCount = await Post.countDocuments({ isPublished: true });
    console.log('Published posts count:', postCount);
    
    // Test simple find
    const simplePosts = await Post.find({ isPublished: true })
      .limit(2)
      .select('title createdAt author likes comments')
      .lean();
    
    console.log('Simple posts found:', simplePosts.length);
    console.log('Sample post structure:', simplePosts[0]);
    
    // Test with population
    const postsWithAuthor = await Post.find({ isPublished: true })
      .populate('author', 'firstName lastName')
      .limit(2)
      .lean();
    
    console.log('Posts with author found:', postsWithAuthor.length);
    
    res.json({
      success: true,
      postCount,
      simplePosts,
      postsWithAuthor,
      message: 'Debug successful - discover route should work now'
    });
    
  } catch (error) {
    console.error('Debug route error:', error);
    res.status(500).json({
      error: error.message,
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