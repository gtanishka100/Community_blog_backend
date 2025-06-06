const mongoose = require('mongoose');

const connectionSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'blocked'],
    default: 'pending'
  },
  message: {
    type: String,
    maxlength: 500,
    trim: true
  }
}, {
  timestamps: true
});

// Ensure unique connection requests
connectionSchema.index({ requester: 1, recipient: 1 }, { unique: true });

// Add indexes for better query performance
connectionSchema.index({ recipient: 1, status: 1 });
connectionSchema.index({ requester: 1, status: 1 });

// Prevent self-connections
connectionSchema.pre('save', function(next) {
  if (this.requester.equals(this.recipient)) {
    const error = new Error('Cannot connect to yourself');
    return next(error);
  }
  next();
});

module.exports = mongoose.model('Connection', connectionSchema);