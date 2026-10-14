const jwt = require('jsonwebtoken');

/**
 * Generate a signed JWT token for a user
 * Payload contains: id, role, businessId
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      businessId: user.businessId || null,
    },
    process.env.JWT_SECRET || 'karibu_super_secret_jwt_key_2026',
    {
      expiresIn: process.env.JWT_EXPIRE || '24h',
    }
  );
};

module.exports = generateToken;
