const jwt = require('jsonwebtoken');
const { User, Business } = require('../models');

/**
 * Verify JWT token from Authorization header
 */
const verifyToken = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authentication token provided.',
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'karibu_super_secret_jwt_key_2026'
    );

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User belonging to this token no longer exists.',
      });
    }

    if (!user.active) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact administrator.',
      });
    }

    // Attach verified user to request object
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
      error: error.message,
    });
  }
};

/**
 * Restrict access to specific roles (e.g. ADMIN, BUSINESS_OWNER, STAFF)
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required before checking role.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role '${req.user.role}' is not authorized to access this resource.`,
      });
    }

    next();
  };
};

/**
 * Enforce multi-business tenant isolation.
 * Guarantees that BUSINESS_OWNER and STAFF can ONLY access resources belonging to their own businessId.
 */
const verifyBusinessAccess = async (req, res, next) => {
  if (req.user.role === 'ADMIN') {
    // Admin has platform-wide access
    return next();
  }

  if (!req.user.businessId) {
    return res.status(403).json({
      success: false,
      message: 'User is not associated with any active business.',
    });
  }

  // If a businessId is specified in params or query, enforce strict equality
  const requestedBusinessId =
    req.params.businessId || req.query.businessId || req.body.businessId;

  if (
    requestedBusinessId &&
    requestedBusinessId.toString() !== req.user.businessId.toString()
  ) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: You do not have permission to access another business data.',
    });
  }

  // Ensure the user's business itself is ACTIVE
  const business = await Business.findById(req.user.businessId);
  if (!business || business.status !== 'ACTIVE') {
    return res.status(403).json({
      success: false,
      message: 'The business account is currently inactive or suspended.',
    });
  }

  req.business = business;
  next();
};

module.exports = {
  verifyToken,
  requireRole,
  verifyBusinessAccess,
};
