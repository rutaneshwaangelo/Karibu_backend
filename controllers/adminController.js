const {
  User,
  Business,
  Category,
  Service,
  Queue,
  OpeningHours,
  Subscription,
} = require('../models');

/**
 * @desc    Get Admin Dashboard KPIs
 * @route   GET /api/admin/dashboard
 * @access  Private (ADMIN)
 */
const getDashboardKPIs = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalBusinesses,
      activeBusinesses,
      totalCategories,
      totalUsers,
      queuesToday,
      activeServingCount,
      waitingCount,
      completedTodayCount,
    ] = await Promise.all([
      Business.countDocuments(),
      Business.countDocuments({ status: 'ACTIVE' }),
      Category.countDocuments({ active: true }),
      User.countDocuments(),
      Queue.countDocuments({ joinedAt: { $gte: today } }),
      Queue.countDocuments({ status: 'SERVING' }),
      Queue.countDocuments({ status: 'WAITING' }),
      Queue.countDocuments({ status: 'COMPLETED', completedAt: { $gte: today } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalBusinesses,
        activeBusinesses,
        totalCategories,
        totalUsers,
        queuesToday,
        activeServingCount,
        waitingCount,
        completedTodayCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Register a new business with its owner, initial hours, and subscription
 * @route   POST /api/admin/businesses
 * @access  Private (ADMIN)
 */
const registerBusiness = async (req, res, next) => {
  try {
    const {
      name,
      categoryId,
      ownerName,
      email,
      phone,
      location,
      address,
      password,
      status = 'ACTIVE',
    } = req.body;

    // Validation
    if (!name || !categoryId || !ownerName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide business name, category, owner name, email, and password.',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if owner email is already taken
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user account with this email address already exists.',
      });
    }

    // Verify category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Selected business category does not exist.',
      });
    }

    // 1. Create Business Owner User
    const owner = await User.create({
      name: ownerName.trim(),
      email: cleanEmail,
      password,
      phone: phone ? phone.trim() : '',
      role: 'BUSINESS_OWNER',
      active: true,
    });

    // 2. Create Business Record
    const business = await Business.create({
      name: name.trim(),
      categoryId: category._id,
      ownerId: owner._id,
      location: location ? location.trim() : '',
      address: address ? address.trim() : '',
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      status,
    });

    // 3. Link Owner to Business
    owner.businessId = business._id;
    await owner.save();

    // 4. Initialize Default Opening Hours (Mon-Sun: 0-6)
    const defaultHours = [
      { dayOfWeek: 0, isOpen: false, openingTime: '10:00', closingTime: '16:00' }, // Sun
      { dayOfWeek: 1, isOpen: true, openingTime: '08:00', closingTime: '17:00' },  // Mon
      { dayOfWeek: 2, isOpen: true, openingTime: '08:00', closingTime: '17:00' },  // Tue
      { dayOfWeek: 3, isOpen: true, openingTime: '08:00', closingTime: '17:00' },  // Wed
      { dayOfWeek: 4, isOpen: true, openingTime: '08:00', closingTime: '17:00' },  // Thu
      { dayOfWeek: 5, isOpen: true, openingTime: '08:00', closingTime: '17:00' },  // Fri
      { dayOfWeek: 6, isOpen: true, openingTime: '09:00', closingTime: '15:00' },  // Sat
    ];

    const hoursPromises = defaultHours.map((h) =>
      OpeningHours.create({
        businessId: business._id,
        dayOfWeek: h.dayOfWeek,
        isOpen: h.isOpen,
        openingTime: h.openingTime,
        closingTime: h.closingTime,
      })
    );
    await Promise.all(hoursPromises);

    // 5. Initialize Subscription (1-Month Free Trial: 30 days)
    const subscription = await Subscription.create({
      businessId: business._id,
      plan: 'FREE_TRIAL',
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 1 Month Free Trial
      billingCycle: 'trial',
    });

    res.status(201).json({
      success: true,
      message: `Business "${business.name}" and owner account successfully registered.`,
      data: {
        business,
        owner: {
          id: owner._id,
          name: owner.name,
          email: owner.email,
          role: owner.role,
        },
        subscription,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all businesses with category, owner, and service counts
 * @route   GET /api/admin/businesses
 * @access  Private (ADMIN)
 */
const getBusinesses = async (req, res, next) => {
  try {
    const { status, category, search } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.categoryId = category;
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const businesses = await Business.find(filter)
      .populate('categoryId', 'name')
      .populate('ownerId', 'name email phone')
      .sort({ createdAt: -1 });

    // Aggregate active services and current queues count for each business
    const enriched = await Promise.all(
      businesses.map(async (biz) => {
        const [serviceCount, activeQueueCount] = await Promise.all([
          Service.countDocuments({ businessId: biz._id, active: true }),
          Queue.countDocuments({
            businessId: biz._id,
            status: { $in: ['WAITING', 'SERVING'] },
          }),
        ]);
        return {
          ...biz.toObject(),
          serviceCount,
          activeQueueCount,
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
 * @desc    Update business details or status
 * @route   PUT /api/admin/businesses/:id
 * @access  Private (ADMIN)
 */
const updateBusiness = async (req, res, next) => {
  try {
    const { name, categoryId, location, address, phone, email, status } = req.body;

    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    if (name) business.name = name.trim();
    if (categoryId) business.categoryId = categoryId;
    if (location !== undefined) business.location = location.trim();
    if (address !== undefined) business.address = address.trim();
    if (phone !== undefined) business.phone = phone.trim();
    if (email !== undefined) business.email = email.trim();
    if (status) business.status = status;

    await business.save();

    res.status(200).json({
      success: true,
      message: 'Business updated successfully',
      data: business,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all categories
 * @route   GET /api/admin/categories
 * @access  Private (ADMIN)
 */
const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a category
 * @route   POST /api/admin/categories
 * @access  Private (ADMIN)
 */
const createCategory = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required',
      });
    }

    const category = await Category.create({
      name: name.trim(),
      description: description ? description.trim() : '',
    });

    res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A category with this name already exists.',
      });
    }
    next(error);
  }
};

/**
 * @desc    Update a category
 * @route   PUT /api/admin/categories/:id
 * @access  Private (ADMIN)
 */
const updateCategory = async (req, res, next) => {
  try {
    const { name, description, active } = req.body;
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
      });
    }

    if (name) category.name = name.trim();
    if (description !== undefined) category.description = description.trim();
    if (active !== undefined) category.active = active;

    await category.save();

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a category
 * @route   DELETE /api/admin/categories/:id
 * @access  Private (ADMIN)
 */
const deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
      });
    }

    // Check if any business uses this category
    const usedCount = await Business.countDocuments({ categoryId: category._id });
    if (usedCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: ${usedCount} business(es) are assigned to this category. Deactivate it instead.`,
      });
    }

    await Category.findByIdAndDelete(category._id);

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users with role and business details
 * @route   GET /api/admin/users
 * @access  Private (ADMIN)
 */
const getUsers = async (req, res, next) => {
  try {
    const { role, businessId } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (businessId) filter.businessId = businessId;

    const users = await User.find(filter)
      .populate('businessId', 'name status')
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle user active status
 * @route   PATCH /api/admin/users/:id/toggle-status
 * @access  Private (ADMIN)
 */
const toggleUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.role === 'ADMIN' && user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own administrative account.',
      });
    }

    user.active = !user.active;
    await user.save();

    res.status(200).json({
      success: true,
      message: `User ${user.name} is now ${user.active ? 'active' : 'inactive'}.`,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get live queue overview across all businesses
 * @route   GET /api/admin/queues
 * @access  Private (ADMIN)
 */
const getQueueOverview = async (req, res, next) => {
  try {
    const activeQueues = await Queue.find({
      status: { $in: ['SERVING', 'WAITING'] },
    })
      .populate('businessId', 'name location')
      .populate('serviceId', 'name durationMinutes')
      .populate('customerId', 'name phone')
      .sort({ joinedAt: 1 });

    res.status(200).json({
      success: true,
      count: activeQueues.length,
      data: activeQueues,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all subscriptions
 * @route   GET /api/admin/subscriptions
 * @access  Private (ADMIN)
 */
const getSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await Subscription.find()
      .populate('businessId', 'name email phone status')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: subscriptions.length,
      data: subscriptions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a business subscription
 * @route   PUT /api/admin/subscriptions/:id
 * @access  Private (ADMIN)
 */
const updateSubscription = async (req, res, next) => {
  try {
    const { plan, status, endDate } = req.body;
    const sub = await Subscription.findById(req.params.id);

    if (!sub) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    if (plan) sub.plan = plan;
    if (status) sub.status = status;
    if (endDate) sub.endDate = new Date(endDate);

    await sub.save();

    res.status(200).json({
      success: true,
      data: sub,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get platform reports
 * @route   GET /api/admin/reports
 * @access  Private (ADMIN)
 */
const getReports = async (req, res, next) => {
  try {
    const totalQueuesServed = await Queue.countDocuments({ status: 'COMPLETED' });
    const totalQueuesWaiting = await Queue.countDocuments({ status: 'WAITING' });
    const totalCancelled = await Queue.countDocuments({ status: { $in: ['LEFT', 'CANCELLED'] } });

    // Aggregation: queues per category
    const categoryStats = await Queue.aggregate([
      {
        $lookup: {
          from: 'businesses',
          localField: 'businessId',
          foreignField: '_id',
          as: 'biz',
        },
      },
      { $unwind: '$biz' },
      {
        $lookup: {
          from: 'categories',
          localField: 'biz.categoryId',
          foreignField: '_id',
          as: 'cat',
        },
      },
      { $unwind: '$cat' },
      {
        $group: {
          _id: '$cat.name',
          totalQueues: { $sum: 1 },
        },
      },
      { $sort: { totalQueues: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalQueuesServed,
        totalQueuesWaiting,
        totalCancelled,
        categoryStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardKPIs,
  registerBusiness,
  getBusinesses,
  updateBusiness,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getUsers,
  toggleUserStatus,
  getQueueOverview,
  getSubscriptions,
  updateSubscription,
  getReports,
};
