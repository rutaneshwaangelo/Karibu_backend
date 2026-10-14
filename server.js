const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// =====================================================
// SOCKET.IO
// =====================================================

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  },
});

// =====================================================
// DATABASE
// =====================================================

connectDB();

// =====================================================
// CORS
// =====================================================

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);

// =====================================================
// BODY PARSERS
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// SOCKET.IO ACCESS FOR CONTROLLERS
// =====================================================

app.use((req, res, next) => {
  req.io = io;
  next();
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'KARIBU Smart Queue Management System',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// =====================================================
// API ROUTES
// =====================================================

app.use('/api/auth', require('./routes/authRoutes'));

app.use('/api/admin', require('./routes/adminRoutes'));

app.use('/api/business', require('./routes/businessRoutes'));

app.use('/api/services', require('./routes/serviceRoutes'));

app.use('/api/staff', require('./routes/staffRoutes'));

app.use('/api/customer', require('./routes/customerRoutes'));

// =====================================================
// QUEUE ENGINE
// =====================================================

// NOTE:
// The automatic queue engine depends on a persistent Node.js
// process. We start it only when the server is running normally.
// This prevents it from continuously starting inside Vercel
// serverless requests.

if (process.env.NODE_ENV !== 'production') {
  const { startQueueEngine } = require('./services/queueEngine');

  startQueueEngine(io, 5000);
}

// =====================================================
// SOCKET.IO CONNECTION
// =====================================================

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Business dashboard room
  socket.on('join_business', (businessId) => {
    if (businessId) {
      socket.join(`business:${businessId}`);

      console.log(
        `[Socket.IO] Socket ${socket.id} joined room business:${businessId}`
      );
    }
  });

  // Customer queue room
  socket.on('join_queue', (queueId) => {
    if (queueId) {
      socket.join(`queue:${queueId}`);

      console.log(
        `[Socket.IO] Socket ${socket.id} joined room queue:${queueId}`
      );
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error('[Error]', err.stack || err.message);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',

    error:
      process.env.NODE_ENV === 'development'
        ? err.stack
        : undefined,
  });
});

// =====================================================
// LOCAL DEVELOPMENT SERVER
// =====================================================

// Only start a traditional server when running locally.
// Vercel will use the exported Express app.
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[KARIBU API] Server running in ${
        process.env.NODE_ENV || 'development'
      } mode on port ${PORT}`
    );
  });
}
// =====================================================
// EXPORT
// =====================================================

module.exports = app;