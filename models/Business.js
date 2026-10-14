const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide business name'],
      trim: true,
      maxlength: 120,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Please provide a business category'],
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Business must have an owner'],
    },
    location: {
      type: String,
      trim: true,
      default: '', // City / Area
    },
    address: {
      type: String,
      trim: true,
      default: '', // Detailed physical address
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
        message: '{VALUE} is not a valid business status',
      },
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

businessSchema.index({ name: 1 });
businessSchema.index({ categoryId: 1 });
businessSchema.index({ ownerId: 1 });
businessSchema.index({ status: 1 });

module.exports = mongoose.model('Business', businessSchema);
