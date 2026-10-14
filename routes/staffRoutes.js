const express = require('express');
const router = express.Router();
const {
  getBusinessActiveQueue,
  staffAdjustTime,
  cancelQueueEntry,
} = require('../controllers/queueController');

const {
  verifyToken,
  requireRole,
  verifyBusinessAccess,
} = require('../middleware/auth');

// Protect for STAFF or BUSINESS_OWNER
router.use(verifyToken, requireRole('STAFF', 'BUSINESS_OWNER'), verifyBusinessAccess);

router.get('/queue', getBusinessActiveQueue);
router.post('/queue/:id/adjust-time', staffAdjustTime);
router.post('/queue/:id/cancel', cancelQueueEntry);

module.exports = router;
