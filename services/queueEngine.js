const { Queue, Service } = require('../models');

/**
 * Generate daily sequential queue number per business (e.g. K001, K002...)
 */
const generateQueueNumber = async (businessId) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const countToday = await Queue.countDocuments({
    businessId,
    joinedAt: { $gte: startOfDay },
  });

  const nextNumber = countToday + 1;
  return `K${String(nextNumber).padStart(3, '0')}`;
};

/**
 * Recalculate estimated waiting times for all WAITING customers in a business
 */
const recalculateWaitTimes = async (businessId) => {
  try {
    // 1. Check current serving customer
    const currentServing = await Queue.findOne({
      businessId,
      status: 'SERVING',
    });

    let accumulatedWait = 0;

    if (currentServing && currentServing.expectedEndAt) {
      const remainingMs = new Date(currentServing.expectedEndAt).getTime() - Date.now();
      accumulatedWait = Math.max(0, Math.ceil(remainingMs / 60000));
    }

    // 2. Fetch all waiting customers ordered by joinedAt
    const waitingQueue = await Queue.find({
      businessId,
      status: 'WAITING',
    })
      .sort({ joinedAt: 1 })
      .populate('serviceId', 'durationMinutes');

    for (const item of waitingQueue) {
      item.estimatedWaitMinutes = accumulatedWait;
      await item.save();

      const serviceDuration = item.serviceId?.durationMinutes || 15;
      accumulatedWait += serviceDuration;
    }
  } catch (error) {
    console.error(`[QueueEngine] Error recalculating wait times for business ${businessId}:`, error.message);
  }
};

/**
 * Automatically promote the next WAITING customer to SERVING if no customer is currently being served
 */
const promoteNextCustomer = async (businessId, io = null) => {
  try {
    // Ensure no one is currently serving
    const activeServing = await Queue.findOne({
      businessId,
      status: 'SERVING',
    });

    if (activeServing) {
      return activeServing; // Someone is already being served
    }

    // Find the next waiting customer
    const nextCustomer = await Queue.findOne({
      businessId,
      status: 'WAITING',
    })
      .sort({ joinedAt: 1 })
      .populate('serviceId', 'name durationMinutes')
      .populate('customerId', 'name phone');

    if (!nextCustomer) {
      return null; // Queue is empty
    }

    const now = new Date();
    const durationMinutes = nextCustomer.serviceId?.durationMinutes || 15;
    const expectedEnd = new Date(now.getTime() + durationMinutes * 60000);

    nextCustomer.status = 'SERVING';
    nextCustomer.startedAt = now;
    nextCustomer.expectedEndAt = expectedEnd;
    nextCustomer.extensionMinutes = 0;
    nextCustomer.estimatedWaitMinutes = 0;
    await nextCustomer.save();

    // Recalculate remaining waiting customers
    await recalculateWaitTimes(businessId);

    // Emit real-time events
    if (io) {
      io.to(`business:${businessId}`).emit('queue_updated', {
        action: 'customer_serving',
        customer: nextCustomer,
      });

      io.to(`queue:${nextCustomer._id}`).emit('customer_status_changed', {
        status: 'SERVING',
        queue: nextCustomer,
      });
    }

    console.log(`[QueueEngine] Customer ${nextCustomer.queueNumber} is now SERVING for business ${businessId}. Expected end: ${expectedEnd.toLocaleTimeString()}`);
    return nextCustomer;
  } catch (error) {
    console.error(`[QueueEngine] Error promoting next customer for business ${businessId}:`, error.message);
    return null;
  }
};

/**
 * Periodic tick: Checks for expired SERVING entries, completes them, and starts next customer
 */
const processQueueTick = async (io = null) => {
  try {
    const now = new Date();

    // Find all SERVING entries whose expectedEndAt is reached or passed
    const expiredEntries = await Queue.find({
      status: 'SERVING',
      expectedEndAt: { $lte: now },
    })
      .populate('serviceId', 'name')
      .populate('customerId', 'name');

    for (const entry of expiredEntries) {
      entry.status = 'COMPLETED';
      entry.completedAt = now;

      if (entry.startedAt) {
        entry.actualDurationMinutes = Math.max(
          1,
          Math.round((now.getTime() - new Date(entry.startedAt).getTime()) / 60000)
        );
      }

      await entry.save();

      console.log(`[QueueEngine] Auto-completed: ${entry.queueNumber} (${entry.serviceId?.name}) for business ${entry.businessId}`);

      // Notify customer that service completed
      if (io) {
        io.to(`queue:${entry._id}`).emit('customer_status_changed', {
          status: 'COMPLETED',
          queue: entry,
        });
      }

      // Automatically promote next waiting customer for this business
      await promoteNextCustomer(entry.businessId, io);

      // Notify business dashboard
      if (io) {
        io.to(`business:${entry.businessId}`).emit('queue_updated', {
          action: 'customer_completed',
          completedCustomer: entry,
        });
      }
    }
  } catch (error) {
    console.error('[QueueEngine] Error in processQueueTick:', error.message);
  }
};

/**
 * Staff Time Adjustment Feature (+5, +10, +15, -5, -10 minutes)
 */
const adjustServiceTime = async (businessId, queueId, adjustmentMinutes, io = null) => {
  const allowedAdjustments = [5, 10, 15, -5, -10];
  const mins = parseInt(adjustmentMinutes, 10);

  if (!allowedAdjustments.includes(mins)) {
    throw new Error(`Invalid adjustment. Allowed options are: ${allowedAdjustments.join(', ')} minutes.`);
  }

  const entry = await Queue.findOne({
    _id: queueId,
    businessId,
  })
    .populate('serviceId', 'name durationMinutes')
    .populate('customerId', 'name');

  if (!entry) {
    throw new Error('Queue record not found in this business.');
  }

  if (entry.status !== 'SERVING') {
    throw new Error(`Cannot adjust time: customer is currently ${entry.status}, not SERVING.`);
  }

  const currentExpected = new Date(entry.expectedEndAt).getTime();
  const newExpectedMs = currentExpected + mins * 60000;
  const minAllowedMs = Date.now() + 30000; // Must stay at least 30 seconds into the future

  if (newExpectedMs < minAllowedMs) {
    throw new Error('Cannot reduce time further: service is already nearing completion.');
  }

  // Check maximum extension guard (+120 minutes)
  const newTotalExtension = (entry.extensionMinutes || 0) + mins;
  if (newTotalExtension > 120) {
    throw new Error('Maximum total extension limit (120 minutes) reached.');
  }

  entry.extensionMinutes = newTotalExtension;
  entry.expectedEndAt = new Date(newExpectedMs);
  await entry.save();

  // Recalculate wait times for waiting customers behind this one
  await recalculateWaitTimes(businessId);

  // Broadcast real-time update
  if (io) {
    io.to(`business:${businessId}`).emit('queue_updated', {
      action: 'time_adjusted',
      adjustedBy: mins,
      queue: entry,
    });

    io.to(`queue:${entry._id}`).emit('service_time_adjusted', {
      extensionMinutes: entry.extensionMinutes,
      expectedEndAt: entry.expectedEndAt,
    });
  }

  return entry;
};

/**
 * Initialize Queue Engine interval
 */
let engineInterval = null;

const startQueueEngine = (io, intervalMs = 5000) => {
  if (engineInterval) {
    clearInterval(engineInterval);
  }

  console.log(`[QueueEngine] Engine initialized. Running cycle every ${intervalMs / 1000}s`);
  engineInterval = setInterval(() => {
    processQueueTick(io);
  }, intervalMs);

  return engineInterval;
};

const stopQueueEngine = () => {
  if (engineInterval) {
    clearInterval(engineInterval);
    engineInterval = null;
    console.log('[QueueEngine] Engine stopped.');
  }
};

module.exports = {
  generateQueueNumber,
  recalculateWaitTimes,
  promoteNextCustomer,
  processQueueTick,
  adjustServiceTime,
  startQueueEngine,
  stopQueueEngine,
};
