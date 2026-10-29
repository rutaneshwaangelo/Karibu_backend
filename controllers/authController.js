const { User } = require('../models');
const generateToken = require('../utils/generateToken');

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password',
      });
    }

    // Find user by email, explicitly including password field for verification.
    // The business is populated in the same round trip instead of a second query.
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password')
      .populate('businessId', 'name location status');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password credentials',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password credentials',
      });
    }

    if (!user.active) {
      return res.status(403).json({
        success: false,
        message: 'Your account is deactivated. Please contact an administrator.',
      });
    }

    // If user is owner or staff, check business status
    let businessDetails = null;
    if (user.businessId) {
      const business = user.businessId; // populated document
      if (!business) {
        return res.status(403).json({
          success: false,
          message: 'The business assigned to this account does not exist.',
        });
      }
      if (business.status !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          message: `The business is currently ${business.status.toLowerCase()}. Please contact the administrator.`,
        });
      }
      businessDetails = {
        id: business._id,
        name: business.name,
        location: business.location,
        status: business.status,
      };

      // Restore the ObjectId so the JWT payload and response stay flat.
      user.businessId = business._id;
    }

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        businessId: user.businessId,
        business: businessDetails,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current logged in user details
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'businessId',
      populate: { path: 'categoryId', select: 'name' },
    });

    let business = user.businessId || null;
    if (business) {
      user.businessId = business._id;
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        businessId: user.businessId,
        business,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Log user out / clear context
 * @route   POST /api/auth/logout
 * @access  Public
 */
const logout = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};

module.exports = {
  login,
  getMe,
  logout,
};
