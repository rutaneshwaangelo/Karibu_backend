const { Business, Service, Category } = require('../models');

/**
 * @desc    Get all active businesses with search and category filters
 * @route   GET /api/customer/businesses
 * @access  Public
 */
const getActiveBusinesses = async (req, res, next) => {
  try {
    const { category, search, location } = req.query;
    const filter = { status: 'ACTIVE' };

    if (category) filter.categoryId = category;
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }
    if (location) {
      filter.location = { $regex: location, $options: 'i' };
    }

    const businesses = await Business.find(filter)
      .populate('categoryId', 'name')
      .sort({ name: 1 });

    // Enriched with active service count
    const enriched = await Promise.all(
      businesses.map(async (biz) => {
        const services = await Service.find({
          businessId: biz._id,
          active: true,
        }).select('name durationMinutes description');

        return {
          id: biz._id,
          name: biz.name,
          category: biz.categoryId?.name,
          categoryId: biz.categoryId?._id,
          location: biz.location,
          address: biz.address,
          phone: biz.phone,
          services,
        };
      })
    );

    res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get detailed business info and its active services
 * @route   GET /api/customer/businesses/:id
 * @access  Public
 */
const getBusinessDetails = async (req, res, next) => {
  try {
    const business = await Business.findOne({
      _id: req.params.id,
      status: 'ACTIVE',
    }).populate('categoryId', 'name description');

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found or is currently inactive.',
      });
    }

    const services = await Service.find({
      businessId: business._id,
      active: true,
    }).sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: {
        id: business._id,
        name: business.name,
        category: business.categoryId?.name,
        location: business.location,
        address: business.address,
        phone: business.phone,
        email: business.email,
        services,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all active categories for customer filtering
 * @route   GET /api/customer/categories
 * @access  Public
 */
const getPublicCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({ active: true }).sort({ name: 1 });
    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActiveBusinesses,
  getBusinessDetails,
  getPublicCategories,
};
