const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Queue entry must belong to a business'],
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: [true, 'Queue entry must have a service'],
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Queue entry must belong to a customer'],
    },
    queueNumber: {
      type: String,
      required: [true, 'Queue number is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ['WAITING', 'SERVING', 'COMPLETED', 'LEFT', 'CANCELLED'],
        message: '{VALUE} is not a valid queue status',
      },
      default: 'WAITING',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    expectedEndAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    leftAt: {
      type: Date,
      default: null,
    },
    estimatedWaitMinutes: {
      type: Number,
      default: 0,
    },
    actualDurationMinutes: {
      type: Number,
      default: null,
    },
    extensionMinutes: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// High performance indexes for real-time queue engine & dashboard lookups
queueSchema.index({ businessId: 1, status: 1 });
queueSchema.index({ businessId: 1, queueNumber: 1 });
queueSchema.index({ status: 1, expectedEndAt: 1 });
queueSchema.index({ businessId: 1, joinedAt: 1 });

module.exports = mongoose.model('Queue', queueSchema);
