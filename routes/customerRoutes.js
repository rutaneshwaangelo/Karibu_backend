const express = require('express');
const router = express.Router();
const {
  getActiveBusinesses,
  getBusinessDetails,
  getPublicCategories,
} = require('../controllers/customerController');

const {
  joinQueue,
  getQueueStatus,
  leaveQueue,
} = require('../controllers/queueController');

// Public endpoints for customers
router.get('/businesses', getActiveBusinesses);
router.get('/businesses/:id', getBusinessDetails);
router.get('/categories', getPublicCategories);

// Queue actions
router.post('/queue/join', joinQueue);
router.get('/queue/:id', getQueueStatus);
router.post('/queue/:id/leave', leaveQueue);

module.exports = router;
