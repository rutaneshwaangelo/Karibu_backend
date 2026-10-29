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
 * Populate the relations needed by the public queue status payload.
 */
const populateQueueStatus = (query) =>
  query
    .populate('businessId', 'name location phone address')
    .populate('serviceId', 'name durationMinutes')
    .populate('customerId', 'name phone');

/**
 * Build the public payload describing where a customer is in the line.
 */
const buildQueueStatus = async (queue) => {
  let position = 0;

  if (queue.status === 'WAITING') {
    // Count and existence check are independent — run them in parallel.
    const [aheadCount, isServingExist] = await Promise.all([
      Queue.countDocuments({
        businessId: queue.businessId._id,
        status: 'WAITING',
        joinedAt: { $lt: queue.joinedAt },
      }),
      Queue.exists({
        businessId: queue.businessId._id,
        status: 'SERVING',
      }),
    ]);
    position = aheadCount + (isServingExist ? 1 : 0);
  } else if (queue.status === 'SERVING') {
    position = 0; // You are being served now!
  }

  return {
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
  };
};

/**
 * @desc    Customer tracks their live queue status
 * @route   GET /api/customer/queue/:id
 * @access  Public
 */
const getQueueStatus = async (req, res, next) => {
  try {
    const queue = await populateQueueStatus(Queue.findById(req.params.id));

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found',
      });
    }

    res.status(200).json({
      success: true,
      data: await buildQueueStatus(queue),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Find a customer's place in the line by ticket number or name
 * @route   POST /api/customer/queue/track
 * @access  Public
 */
const trackQueue = async (req, res, next) => {
  try {
    const rawQuery =
      req.body?.query ??
      req.body?.ticketNumber ??
      req.body?.queueNumber ??
      req.body?.ticket ??
      req.body?.name ??
      req.body?.customerName ??
      req.body?.search ??
      req.query?.query ??
      req.query?.ticket ??
      req.query?.ticketNumber ??
      req.query?.name ??
      req.query?.search;

    if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
      return res.status(400).json({
        success: false,
        message:
          'Please enter your ticket number or the name you used to join the queue.',
      });
    }

    const search = rawQuery.trim();
    const ticket = search.toUpperCase();
    const activeStatuses = ['WAITING', 'SERVING'];
    let matchedEntries = [];

    if (/^K\d{1,4}$/.test(ticket)) {
      // One ticket number can exist per business on the same day, so return
      // every active entry carrying it.
      matchedEntries = await Queue.find({
        queueNumber: ticket,
        status: { $in: activeStatuses },
      })
        .populate('businessId', 'name location')
        .populate('serviceId', 'name durationMinutes')
        .populate('customerId', 'name')
        .sort({ joinedAt: -1 })
        .lean();
    } else {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const customers = await Customer.find({
        name: { $regex: escaped, $options: 'i' },
      })
        .select('_id')
        .lean();

      if (customers.length > 0) {
        matchedEntries = await Queue.find({
          customerId: { $in: customers.map((customer) => customer._id) },
          status: { $in: activeStatuses },
        })
          .populate('businessId', 'name location')
          .populate('serviceId', 'name durationMinutes')
          .populate('customerId', 'name')
          .sort({ joinedAt: -1 })
          .lean();
      }
    }

    // A name or ticket with no live entry is a valid answer, not an error: the
    // frontend renders its own "no active ticket" message from an empty list.
    if (matchedEntries.length === 0) {
      return res.status(200).json({
        success: true,
        data: { matches: [] },
      });
    }

    const businessIds = [
      ...new Set(
        matchedEntries
          .map((entry) => entry.businessId?._id?.toString())
          .filter(Boolean)
      ),
    ];

    // One query for every active entry in the affected businesses lets us
    // derive positions, the counter's current ticket and the queue length.
    const activeQueues = await Queue.find({
      businessId: { $in: businessIds },
      status: { $in: activeStatuses },
    })
      .select('businessId queueNumber status joinedAt')
      .sort({ joinedAt: 1 })
      .lean();

    const perBusiness = new Map();
    for (const row of activeQueues) {
      const key = row.businessId.toString();
      if (!perBusiness.has(key)) {
        perBusiness.set(key, { waiting: [], serving: null });
      }
      const group = perBusiness.get(key);
      if (row.status === 'SERVING') {
        if (!group.serving) group.serving = row;
      } else {
        group.waiting.push(row);
      }
    }

    const matches = matchedEntries.map((entry) => {
      const key = entry.businessId?._id?.toString();
      const group = key ? perBusiness.get(key) : null;
      const waiting = group?.waiting || [];
      const serving = group?.serving || null;

      let peopleAhead = 0;
      if (entry.status === 'WAITING') {
        const index = waiting.findIndex(
          (row) => row._id.toString() === entry._id.toString()
        );
        peopleAhead =
          (index >= 0 ? index : waiting.length) + (serving ? 1 : 0);
      }

      return {
        queueId: entry._id,
        queueNumber: entry.queueNumber,
        status: entry.status,
        peopleAhead,
        placeInLine: entry.status === 'SERVING' ? 1 : peopleAhead + 1,
        estimatedWaitMinutes: entry.estimatedWaitMinutes || 0,
        nowServing: serving ? serving.queueNumber : null,
        totalWaiting: waiting.length,
        business: {
          id: entry.businessId?._id,
          name: entry.businessId?.name,
          location: entry.businessId?.location,
        },
        customer: { name: entry.customerId?.name },
        service: {
          name: entry.serviceId?.name,
          durationMinutes: entry.serviceId?.durationMinutes,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: { matches },
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
 * @desc    Mark the customer currently being served as COMPLETED and promote the next
 * @route   POST /api/staff/queue/:id/complete
 * @access  Private (STAFF, BUSINESS_OWNER)
 */
const completeQueueEntry = async (req, res, next) => {
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

    if (queue.status !== 'SERVING') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete: customer is currently ${queue.status}, not SERVING.`,
      });
    }

    const now = new Date();
    queue.status = 'COMPLETED';
    queue.completedAt = now;

    if (queue.startedAt) {
      queue.actualDurationMinutes = Math.max(
        1,
        Math.round((now.getTime() - new Date(queue.startedAt).getTime()) / 60000)
      );
    }

    await queue.save();

    // The desk is free again — start the next waiting customer.
    await promoteNextCustomer(queue.businessId, req.io);

    if (req.io) {
      req.io.to(`business:${queue.businessId}`).emit('queue_updated', {
        action: 'customer_completed',
        queueNumber: queue.queueNumber,
      });
      req.io.to(`queue:${queue._id}`).emit('customer_status_changed', {
        status: 'COMPLETED',
      });
    }

    res.status(200).json({
      success: true,
      message: `Queue entry ${queue.queueNumber} completed.`,
      data: { queueId: queue._id, status: queue.status },
    });
  } catch (error) {
    next(error);
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
  trackQueue,
  leaveQueue,
  getBusinessActiveQueue,
  staffAdjustTime,
  completeQueueEntry,
  cancelQueueEntry,
};
