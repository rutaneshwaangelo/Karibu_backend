const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/adminController');

const { verifyToken, requireRole } = require('../middleware/auth');

// All admin routes require ADMIN role
router.use(verifyToken, requireRole('ADMIN'));

router.get('/dashboard', getDashboardKPIs);

// Businesses
router.post('/businesses', registerBusiness);
router.get('/businesses', getBusinesses);
router.put('/businesses/:id', updateBusiness);

// Categories
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Users
router.get('/users', getUsers);
router.patch('/users/:id/toggle-status', toggleUserStatus);

// Queues Overview
router.get('/queues', getQueueOverview);

// Subscriptions
router.get('/subscriptions', getSubscriptions);
router.put('/subscriptions/:id', updateSubscription);

// Reports
router.get('/reports', getReports);

module.exports = router;
