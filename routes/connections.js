const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose'); // Add this import
const Connection = require('../models/connection');
const User = require('../models/user');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const validateConnectionRequest = [
  body('userId')
    .isMongoId()
    .withMessage('Valid user ID is required'),
  body('message')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Message must not exceed 500 characters')
];

// POST /api/connections/request 
router.post('/request', requireAuth, validateConnectionRequest, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { userId, message } = req.body;
    
    // Convert userId to ObjectId for proper comparison
    const targetUserId = new mongoose.Types.ObjectId(userId);
    const currentUserId = req.user._id;

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (targetUserId.equals(currentUserId)) {
      return res.status(400).json({ error: 'Cannot connect to yourself' });
    }

    const existingConnection = await Connection.findOne({
      $or: [
        { requester: currentUserId, recipient: targetUserId },
        { requester: targetUserId, recipient: currentUserId }
      ]
    });

    if (existingConnection) {
      return res.status(409).json({ 
        error: 'Connection request already exists',
        status: existingConnection.status
      });
    }

    // Create new connection request
    const connection = new Connection({
      requester: currentUserId,
      recipient: targetUserId,
      message: message || ''
    });

    await connection.save();
    await connection.populate('requester', 'firstName lastName email');
    await connection.populate('recipient', 'firstName lastName email');

    res.status(201).json({
      message: 'Connection request sent successfully',
      connection
    });
  } catch (error) {
    console.error('Send connection request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/connections/requests - Get incoming connection requests
router.get('/requests', requireAuth, async (req, res) => {
  try {
    const requests = await Connection.find({
      recipient: req.user._id,
      status: 'pending'
    })
    .populate('requester', 'firstName lastName email')
    .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    console.error('Get connection requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/connections/sent - Get sent connection requests
router.get('/sent', requireAuth, async (req, res) => {
  try {
    const sentRequests = await Connection.find({
      requester: req.user._id,
      status: 'pending'
    })
    .populate('recipient', 'firstName lastName email')
    .sort({ createdAt: -1 });

    res.json(sentRequests);
  } catch (error) {
    console.error('Get sent requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/connections/:id/accept - Accept a connection request
router.put('/:id/accept', requireAuth, async (req, res) => {
  try {
    const connection = await Connection.findById(req.params.id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection request not found' });
    }

    if (!connection.recipient.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to accept this request' });
    }
    
    if (connection.status !== 'pending') {
      return res.status(400).json({ error: 'Connection request is no longer pending' });
    }

    connection.status = 'accepted';
    await connection.save();

    await connection.populate('requester', 'firstName lastName email');
    await connection.populate('recipient', 'firstName lastName email');

    res.json({
      message: 'Connection request accepted',
      connection
    });
  } catch (error) {
    console.error('Accept connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/connections/:id/decline 
router.put('/:id/decline', requireAuth, async (req, res) => {
  try {
    const connection = await Connection.findById(req.params.id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection request not found' });
    }
    if (!connection.recipient.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to decline this request' });
    }

    if (connection.status !== 'pending') {
      return res.status(400).json({ error: 'Connection request is no longer pending' });
    }

    connection.status = 'declined';
    await connection.save();

    res.json({
      message: 'Connection request declined'
    });
  } catch (error) {
    console.error('Decline connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/connections/:id 
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const connection = await Connection.findById(req.params.id);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    if (!connection.requester.equals(req.user._id) && !connection.recipient.equals(req.user._id)) {
      return res.status(403).json({ error: 'Not authorized to remove this connection' });
    }

    await Connection.findByIdAndDelete(req.params.id);

    res.json({ message: 'Connection removed successfully' });
  } catch (error) {
    console.error('Remove connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/connections - Get all connections 
router.get('/', requireAuth, async (req, res) => {
  try {
    const connections = await Connection.find({
      $or: [
        { requester: req.user._id, status: 'accepted' },
        { recipient: req.user._id, status: 'accepted' }
      ]
    })
    .populate('requester', 'firstName lastName email')
    .populate('recipient', 'firstName lastName email')
    .sort({ createdAt: -1 });

    const transformedConnections = connections.map(conn => {
      const connectedUser = conn.requester.equals(req.user._id) 
        ? conn.recipient 
        : conn.requester;
      
      return {
        _id: conn._id,
        connectedUser,
        connectedAt: conn.updatedAt,
        isRequester: conn.requester.equals(req.user._id)
      };
    });

    res.json(transformedConnections);
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/connections/status/:userId 
router.get('/status/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const targetUserId = new mongoose.Types.ObjectId(userId);

    const connection = await Connection.findOne({
      $or: [
        { requester: req.user._id, recipient: targetUserId },
        { requester: targetUserId, recipient: req.user._id }
      ]
    });

    if (!connection) {
      return res.json({ status: 'none' });
    }

    const isRequester = connection.requester.equals(req.user._id);

    res.json({
      status: connection.status,
      connectionId: connection._id,
      isRequester,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt
    });
  } catch (error) {
    console.error('Get connection status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;