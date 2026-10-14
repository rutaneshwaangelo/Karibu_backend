const { Service } = require('../models');

/**
 * @desc    Get all services for the logged-in user's business
 * @route   GET /api/services
 * @access  Private (BUSINESS_OWNER, STAFF)
 */
const getServices = async (req, res, next) => {
  try {
    const services = await Service.find({
      businessId: req.user.businessId,
      active: true,
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new service for the business
 * @route   POST /api/services
 * @access  Private (BUSINESS_OWNER)
 */
const createService = async (req, res, next) => {
  try {
    const { name, description, durationMinutes } = req.body;

    if (!name || durationMinutes === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide service name and estimated duration in minutes.',
      });
    }

    const duration = parseInt(durationMinutes, 10);
    if (isNaN(duration) || duration < 1 || duration > 720) {
      return res.status(400).json({
        success: false,
        message: 'Duration must be an integer between 1 and 720 minutes (12 hours).',
      });
    }

    const service = await Service.create({
      businessId: req.user.businessId,
      name: name.trim(),
      description: description ? description.trim() : '',
      durationMinutes: duration,
      active: true,
    });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a service
 * @route   PUT /api/services/:id
 * @access  Private (BUSINESS_OWNER)
 */
const updateService = async (req, res, next) => {
  try {
    const { name, description, durationMinutes, active } = req.body;

    const service = await Service.findOne({
      _id: req.params.id,
      businessId: req.user.businessId,
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found in your business.',
      });
    }

    if (name) service.name = name.trim();
    if (description !== undefined) service.description = description.trim();
    if (durationMinutes !== undefined) {
      const duration = parseInt(durationMinutes, 10);
      if (isNaN(duration) || duration < 1 || duration > 720) {
        return res.status(400).json({
          success: false,
          message: 'Duration must be an integer between 1 and 720 minutes.',
        });
      }
      service.durationMinutes = duration;
    }
    if (active !== undefined) service.active = active;

    await service.save();

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Deactivate / Delete a service
 * @route   DELETE /api/services/:id
 * @access  Private (BUSINESS_OWNER)
 */
const deleteService = async (req, res, next) => {
  try {
    const service = await Service.findOne({
      _id: req.params.id,
      businessId: req.user.businessId,
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found in your business.',
      });
    }

    // Soft delete so past queue records retain referential integrity
    service.active = false;
    await service.save();

    res.status(200).json({
      success: true,
      message: `Service "${service.name}" has been deactivated.`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServices,
  createService,
  updateService,
  deleteService,
};
