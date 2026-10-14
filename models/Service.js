const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Service must belong to a business'],
    },
    name: {
      type: String,
      required: [true, 'Please provide service name'],
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Estimated duration in minutes is required'],
      min: [1, 'Service duration must be at least 1 minute'],
      max: [720, 'Service duration cannot exceed 12 hours (720 minutes)'],
      validate: {
        validator: Number.isInteger,
        message: 'Duration in minutes must be an integer',
      },
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

serviceSchema.index({ businessId: 1, active: 1 });

module.exports = mongoose.model('Service', serviceSchema);
