const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Subscription must belong to a business'],
      unique: true,
    },
    plan: {
      type: String,
      enum: {
        values: ['FREE_TRIAL', 'BASIC', 'PRO', 'ENTERPRISE'],
        message: '{VALUE} is not a valid subscription plan',
      },
      default: 'FREE_TRIAL',
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'INACTIVE', 'EXPIRED'],
        message: '{VALUE} is not a valid subscription status',
      },
      default: 'ACTIVE',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 1 Month (30 days) Free Trial
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'trial'],
      default: 'trial',
    },
    lastPaymentDate: {
      type: Date,
      default: null,
    },
    lastPaymentAmount: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
