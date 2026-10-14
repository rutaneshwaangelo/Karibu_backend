const {
  Business,
  User,
  Service,
  Queue,
  OpeningHours,
  Subscription,
} = require('../models');

/**
 * @desc    Get Business Owner Dashboard KPIs
 * @route   GET /api/business/dashboard
 * @access  Private (BUSINESS_OWNER)
 */
const getBusinessDashboard = async (req, res, next) => {
  try {
    const businessId = req.user.businessId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalQueuesToday,
      currentServing,
      waitingCount,
      completedToday,
      totalServices,
      totalStaff,
    ] = await Promise.all([
      Queue.countDocuments({ businessId, joinedAt: { $gte: today } }),
      Queue.findOne({ businessId, status: 'SERVING' })
        .populate('serviceId', 'name durationMinutes')
        .populate('customerId', 'name phone'),
      Queue.countDocuments({ businessId, status: 'WAITING' }),
      Queue.countDocuments({
        businessId,
        status: 'COMPLETED',
        completedAt: { $gte: today },
      }),
      Service.countDocuments({ businessId, active: true }),
      User.countDocuments({ businessId, role: 'STAFF', active: true }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalQueuesToday,
        currentServing,
        waitingCount,
        completedToday,
        totalServices,
        totalStaff,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Business Profile
 * @route   GET /api/business/profile
 * @access  Private (BUSINESS_OWNER)
 */
const getBusinessProfile = async (req, res, next) => {
  try {
    const business = await Business.findById(req.user.businessId)
      .populate('categoryId', 'name')
      .populate('ownerId', 'name email phone');

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business profile not found',
      });
    }

    res.status(200).json({
      success: true,
      data: business,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Business Profile
 * @route   PUT /api/business/profile
 * @access  Private (BUSINESS_OWNER)
 */
const updateBusinessProfile = async (req, res, next) => {
  try {
    const { name, location, address, phone, email } = req.body;
    const business = await Business.findById(req.user.businessId);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    if (name) business.name = name.trim();
    if (location !== undefined) business.location = location.trim();
    if (address !== undefined) business.address = address.trim();
    if (phone !== undefined) business.phone = phone.trim();
    if (email !== undefined) business.email = email.trim();

    await business.save();

    res.status(200).json({
      success: true,
      message: 'Business profile updated successfully',
      data: business,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all staff members for this business
 * @route   GET /api/business/staff
 * @access  Private (BUSINESS_OWNER)
 */
const getBusinessStaff = async (req, res, next) => {
  try {
    const staff = await User.find({
      businessId: req.user.businessId,
      role: 'STAFF',
    })
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: staff.length,
      data: staff,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new staff member for this business
 * @route   POST /api/business/staff
 * @access  Private (BUSINESS_OWNER)
 */
const createStaffMember = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide staff name, email, and password.',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user account with this email already exists.',
      });
    }

    const staffUser = await User.create({
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      password,
      role: 'STAFF',
      businessId: req.user.businessId,
      active: true,
    });

    res.status(201).json({
      success: true,
      message: 'Staff member account created successfully',
      data: {
        id: staffUser._id,
        name: staffUser.name,
        email: staffUser.email,
        phone: staffUser.phone,
        role: staffUser.role,
        businessId: staffUser.businessId,
        active: staffUser.active,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove / Deactivate staff member
 * @route   DELETE /api/business/staff/:id
 * @access  Private (BUSINESS_OWNER)
 */
const removeStaffMember = async (req, res, next) => {
  try {
    const staff = await User.findOne({
      _id: req.params.id,
      businessId: req.user.businessId,
      role: 'STAFF',
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found in your business.',
      });
    }

    // Soft delete / deactivate so history remains intact
    staff.active = false;
    await staff.save();

    res.status(200).json({
      success: true,
      message: `Staff member ${staff.name} has been deactivated.`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get business opening hours
 * @route   GET /api/business/opening-hours
 * @access  Private (BUSINESS_OWNER, STAFF)
 */
const getOpeningHours = async (req, res, next) => {
  try {
    const hours = await OpeningHours.find({
      businessId: req.user.businessId,
    }).sort({ dayOfWeek: 1 });

    res.status(200).json({
      success: true,
      data: hours,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update business opening hours
 * @route   PUT /api/business/opening-hours
 * @access  Private (BUSINESS_OWNER)
 */
const updateOpeningHours = async (req, res, next) => {
  try {
    const { hours } = req.body; // Array of { dayOfWeek, isOpen, openingTime, closingTime }

    if (!Array.isArray(hours)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of opening hours.',
      });
    }

    const updateOps = hours.map((h) =>
      OpeningHours.findOneAndUpdate(
        { businessId: req.user.businessId, dayOfWeek: h.dayOfWeek },
        {
          isOpen: h.isOpen,
          openingTime: h.openingTime,
          closingTime: h.closingTime,
        },
        { new: true, upsert: true }
      )
    );

    const updatedHours = await Promise.all(updateOps);

    res.status(200).json({
      success: true,
      message: 'Opening hours updated successfully',
      data: updatedHours,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get business subscription
 * @route   GET /api/business/subscription
 * @access  Private (BUSINESS_OWNER)
 */
const getBusinessSubscription = async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({
      businessId: req.user.businessId,
    });

    res.status(200).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process business subscription payment & renewal
 * @route   POST /api/business/subscription/pay
 * @access  Private (BUSINESS_OWNER)
 */
const paySubscription = async (req, res, next) => {
  try {
    const { plan, billingCycle = 'monthly', paymentMethod = 'Card' } = req.body;

    const validPlans = ['BASIC', 'PRO', 'ENTERPRISE'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid paid plan: BASIC, PRO, or ENTERPRISE.',
      });
    }

    const pricing = {
      BASIC: { monthly: 29, yearly: 290 },
      PRO: { monthly: 59, yearly: 590 },
      ENTERPRISE: { monthly: 120, yearly: 1200 },
    };

    const amount = pricing[plan][billingCycle === 'yearly' ? 'yearly' : 'monthly'];
    const durationDays = billingCycle === 'yearly' ? 365 : 30;

    let subscription = await Subscription.findOne({
      businessId: req.user.businessId,
    });

    const now = new Date();
    let baseStartDate = now;

    if (subscription && subscription.endDate && new Date(subscription.endDate) > now) {
      baseStartDate = new Date(subscription.endDate);
    }

    const newEndDate = new Date(baseStartDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    if (!subscription) {
      subscription = new Subscription({
        businessId: req.user.businessId,
      });
    }

    subscription.plan = plan;
    subscription.status = 'ACTIVE';
    subscription.billingCycle = billingCycle;
    subscription.startDate = subscription.startDate || now;
    subscription.endDate = newEndDate;
    subscription.lastPaymentDate = now;
    subscription.lastPaymentAmount = amount;
    subscription.paymentMethod = paymentMethod;

    await subscription.save();

    res.status(200).json({
      success: true,
      message: `Payment of $${amount} confirmed! Your ${plan} plan is active until ${newEndDate.toLocaleDateString()}.`,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBusinessDashboard,
  getBusinessProfile,
  updateBusinessProfile,
  getBusinessStaff,
  createStaffMember,
  removeStaffMember,
  getOpeningHours,
  updateOpeningHours,
  getBusinessSubscription,
  paySubscription,
};
