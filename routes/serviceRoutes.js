const express = require('express');
const router = express.Router();
const {
  getServices,
  createService,
  updateService,
  deleteService,
} = require('../controllers/serviceController');

const {
  verifyToken,
  requireRole,
  verifyBusinessAccess,
} = require('../middleware/auth');

router.use(verifyToken, verifyBusinessAccess);

// Both Owner and Staff can view services
router.get('/', requireRole('BUSINESS_OWNER', 'STAFF'), getServices);

// Only Owner can modify services
router.post('/', requireRole('BUSINESS_OWNER'), createService);
router.put('/:id', requireRole('BUSINESS_OWNER'), updateService);
router.delete('/:id', requireRole('BUSINESS_OWNER'), deleteService);

module.exports = router;
