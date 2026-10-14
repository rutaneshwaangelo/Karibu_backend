const {
  Queue,
  Customer,
  Service,
  Business,
} = require('../models');

const {
  generateQueueNumber,
  recalculateWaitTimes,
  promoteNextCustomer,
  adjustServiceTime,
} = require('../services/queueEngine');

/**
 * @desc    Customer joins a queue (No authentication required)
 * @route   POST /api/customer/queue/join
 * @access  Public
 */
const joinQueue = async (req, res, next) => {
  try {
    const { businessId, serviceId, customerName, customerPhone } = req.body;

    if (!businessId || !serviceId || !customerName) {
      return res.status(400).json({
        success: false,
        message: 'Please provide businessId, serviceId, and your name.',
      });
    }

    // Verify business is active
    const business = await Business.findById(businessId);
    if (!business || business.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'This business is currently not accepting queue entries.',
      });
    }

    // Verify service is active and belongs to this business
    const service = await Service.findOne({
      _id: serviceId,
      businessId,
      active: true,
    });

    if (!service) {
      return res.status(400).json({
        success: false,
        message: 'Selected service is not available for this business.',
      });
    }

    // 1. Create or record customer
    const customer = await Customer.create({
      name: customerName.trim(),
      phone: customerPhone ? customerPhone.trim() : '',
    });

    // 2. Generate daily sequential queue number (K001, K002...)
    const queueNumber = await generateQueueNumber(businessId);

    // 3. Create queue entry with WAITING status
    const queueEntry = await Queue.create({
      businessId,
      serviceId,
      customerId: customer._id,
      queueNumber,
      status: 'WAITING',
      joinedAt: new Date(),
    });

    // 4. If no one is currently being served, promote this customer immediately!
    const activeServing = await Queue.findOne({
      businessId,
      status: 'SERVING',
    });

    let currentQueueRecord;
    if (!activeServing) {
      currentQueueRecord = await promoteNextCustomer(businessId, req.io);
    } else {
      await recalculateWaitTimes(businessId);
      currentQueueRecord = await Queue.findById(queueEntry._id)
        .populate('serviceId', 'name durationMinutes')
        .populate('customerId', 'name phone');
    }

    // 5. Calculate position (how many people ahead)
    const position = await Queue.countDocuments({
      businessId,
      status: { $in: ['WAITING', 'SERVING'] },
      joinedAt: { $lt: queueEntry.joinedAt },
    });

    // Broadcast update to business dashboard
    if (req.io) {
      req.io.to(`business:${businessId}`).emit('queue_updated', {
        action: 'customer_joined',
        queueNumber,
        customerName: customer.name,
      });
    }

    res.status(201).json({
      success: true,
      message: `Successfully joined queue for ${business.name}!`,
      data: {
        queueId: queueEntry._id,
        queueNumber: queueEntry.queueNumber,
        status: currentQueueRecord ? currentQueueRecord.status : 'WAITING',
        position: position + 1,
        estimatedWaitMinutes: currentQueueRecord ? currentQueueRecord.estimatedWaitMinutes : 0,
        service: {
          id: service._id,
          name: service.name,
          durationMinutes: service.durationMinutes,
        },
        business: {
          id: business._id,
          name: business.name,
          location: business.location,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Customer tracks their live queue status
 * @route   GET /api/customer/queue/:id
 * @access  Public
 */
const getQueueStatus = async (req, res, next) => {
  try {
    const queue = await Queue.findById(req.params.id)
      .populate('businessId', 'name location phone address')
      .populate('serviceId', 'name durationMinutes')
      .populate('customerId', 'name phone');

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found',
      });
    }

    let position = 0;
    if (queue.status === 'WAITING') {
      const aheadCount = await Queue.countDocuments({
        businessId: queue.businessId._id,
        status: 'WAITING',
        joinedAt: { $lt: queue.joinedAt },
      });
      const isServingExist = await Queue.exists({
        businessId: queue.businessId._id,
        status: 'SERVING',
      });
      position = aheadCount + (isServingExist ? 1 : 0);
    } else if (queue.status === 'SERVING') {
      position = 0; // You are being served now!
    }

    res.status(200).json({
      success: true,
      data: {
        queueId: queue._id,
        queueNumber: queue.queueNumber,
        status: queue.status,
        position,
        estimatedWaitMinutes: queue.estimatedWaitMinutes,
        joinedAt: queue.joinedAt,
        startedAt: queue.startedAt,
        expectedEndAt: queue.expectedEndAt,
        extensionMinutes: queue.extensionMinutes || 0,
        customer: {
          name: queue.customerId?.name,
        },
        service: {
          name: queue.serviceId?.name,
          durationMinutes: queue.serviceId?.durationMinutes,
        },
        business: {
          id: queue.businessId?._id,
          name: queue.businessId?.name,
          location: queue.businessId?.location,
          address: queue.businessId?.address,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Customer voluntarily leaves queue
 * @route   POST /api/customer/queue/:id/leave
 * @access  Public
 */
const leaveQueue = async (req, res, next) => {
  try {
    const queue = await Queue.findById(req.params.id);

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found',
      });
    }

    if (queue.status === 'COMPLETED' || queue.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: `Cannot leave: queue is already ${queue.status.toLowerCase()}.`,
      });
    }

    const wasServing = queue.status === 'SERVING';
    queue.status = 'LEFT';
    queue.leftAt = new Date();
    await queue.save();

    if (wasServing) {
      await promoteNextCustomer(queue.businessId, req.io);
    } else {
      await recalculateWaitTimes(queue.businessId);
    }

    if (req.io) {
      req.io.to(`business:${queue.businessId}`).emit('queue_updated', {
        action: 'customer_left',
        queueNumber: queue.queueNumber,
      });
    }

    res.status(200).json({
      success: true,
      message: 'You have left the queue.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get live business queue for Staff and Business Owner
 * @route   GET /api/business/queue OR GET /api/staff/queue
 * @access  Private (BUSINESS_OWNER, STAFF)
 */
const getBusinessActiveQueue = async (req, res, next) => {
  try {
    const businessId = req.user.businessId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [currentServing, waitingList, recentlyCompleted] = await Promise.all([
      Queue.findOne({ businessId, status: 'SERVING' })
        .populate('serviceId', 'name durationMinutes')
        .populate('customerId', 'name phone'),
      Queue.find({ businessId, status: 'WAITING' })
        .populate('serviceId', 'name durationMinutes')
        .populate('customerId', 'name phone')
        .sort({ joinedAt: 1 }),
      Queue.find({
        businessId,
        status: 'COMPLETED',
        completedAt: { $gte: today },
      })
        .populate('serviceId', 'name durationMinutes')
        .populate('customerId', 'name')
        .sort({ completedAt: -1 })
        .limit(10),
    ]);

    res.status(200).json({
      success: true,
      data: {
        currentServing,
        waitingList,
        recentlyCompleted,
        totalWaiting: waitingList.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Staff time adjustment (+5, +10, +15, -5, -10 minutes)
 * @route   POST /api/staff/queue/:id/adjust-time
 * @access  Private (STAFF, BUSINESS_OWNER)
 */
const staffAdjustTime = async (req, res, next) => {
  try {
    const { minutes } = req.body;
    const queueId = req.params.id;
    const businessId = req.user.businessId;

    const updatedQueue = await adjustServiceTime(
      businessId,
      queueId,
      minutes,
      req.io
    );

    res.status(200).json({
      success: true,
      message: `Service duration adjusted by ${minutes > 0 ? '+' : ''}${minutes} minutes.`,
      data: updatedQueue,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Cancel a queue entry (no-show or administrative cancellation)
 * @route   POST /api/business/queue/:id/cancel
 * @access  Private (BUSINESS_OWNER, STAFF)
 */
const cancelQueueEntry = async (req, res, next) => {
  try {
    const queue = await Queue.findOne({
      _id: req.params.id,
      businessId: req.user.businessId,
    });

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found in your business.',
      });
    }

    const wasServing = queue.status === 'SERVING';
    queue.status = 'CANCELLED';
    await queue.save();

    if (wasServing) {
      await promoteNextCustomer(req.user.businessId, req.io);
    } else {
      await recalculateWaitTimes(req.user.businessId);
    }

    if (req.io) {
      req.io.to(`business:${req.user.businessId}`).emit('queue_updated', {
        action: 'customer_cancelled',
        queueNumber: queue.queueNumber,
      });
      req.io.to(`queue:${queue._id}`).emit('customer_status_changed', {
        status: 'CANCELLED',
      });
    }

    res.status(200).json({
      success: true,
      message: `Queue entry ${queue.queueNumber} cancelled.`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  joinQueue,
  getQueueStatus,
  leaveQueue,
  getBusinessActiveQueue,
  staffAdjustTime,
  cancelQueueEntry,
};
