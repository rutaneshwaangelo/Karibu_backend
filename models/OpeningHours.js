const mongoose = require('mongoose');

const openingHoursSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Opening hours must belong to a business'],
    },
    dayOfWeek: {
      type: Number,
      required: [true, 'Day of week is required (0 for Sunday to 6 for Saturday)'],
      min: 0,
      max: 6,
    },
    isOpen: {
      type: Boolean,
      default: true,
    },
    openingTime: {
      type: String,
      default: '09:00', // Format: HH:mm
      trim: true,
    },
    closingTime: {
      type: String,
      default: '18:00', // Format: HH:mm
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure one opening hour record per day per business
openingHoursSchema.index({ businessId: 1, dayOfWeek: 1 }, { unique: true });

module.exports = mongoose.model('OpeningHours', openingHoursSchema);
