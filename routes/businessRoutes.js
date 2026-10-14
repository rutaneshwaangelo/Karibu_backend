const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/businessController');
const {
  getBusinessActiveQueue,
  cancelQueueEntry,
} = require('../controllers/queueController');

const {
  verifyToken,
  requireRole,
  verifyBusinessAccess,
} = require('../middleware/auth');

// Protected for BUSINESS_OWNER with tenant validation
router.use(verifyToken, requireRole('BUSINESS_OWNER'), verifyBusinessAccess);

router.get('/dashboard', getBusinessDashboard);
router.get('/profile', getBusinessProfile);
router.put('/profile', updateBusinessProfile);

// Live Queue
router.get('/queue', getBusinessActiveQueue);
router.post('/queue/:id/cancel', cancelQueueEntry);

// Staff management
router.get('/staff', getBusinessStaff);
router.post('/staff', createStaffMember);
router.delete('/staff/:id', removeStaffMember);

// Opening hours
router.get('/opening-hours', getOpeningHours);
router.put('/opening-hours', updateOpeningHours);

// Subscription
router.get('/subscription', getBusinessSubscription);
router.post('/subscription/pay', paySubscription);

module.exports = router;
