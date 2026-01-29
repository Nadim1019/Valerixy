import express from 'express';
import cors from 'cors';
import http from 'http';
import { initTelemetry, trackEvent } from './telemetry';
import { initPool } from './domain/orderRepository';
import { initServiceBus, closeServiceBus } from './messaging/orderPublisher';
import { startInventoryEventsConsumer, stopInventoryEventsConsumer } from './messaging/inventoryConsumer';
import { initWebSocket } from './interface/websocket';
import routes from './interface/routes';

// Initialize telemetry first
initTelemetry();

const app = express();
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/', routes);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[HTTP] Error:', err);
  res.status(500).json({
    success: false,
    error: err.message,
  });
});

async function main() {
  try {
    console.log('========================================');
    console.log('  ORDER SERVICE - Starting...');
    console.log('========================================');
    
    // Initialize database connection pool
    console.log('[DB] Initializing connection pool...');
    await initPool();
    console.log('[DB] Connection pool ready');
    
    // Initialize Azure Service Bus
    console.log('[ASB] Initializing Service Bus...');
    await initServiceBus();
    
    // Start ASB consumers
    console.log('[ASB] Starting inventory events consumer...');
    await startInventoryEventsConsumer();
    
    // Create HTTP server
    const server = http.createServer(app);
    
    // Initialize WebSocket
    initWebSocket(server);
    
    // Start HTTP server
    server.listen(HTTP_PORT, () => {
      console.log(`[HTTP] Server running on port ${HTTP_PORT}`);
    });
    
    trackEvent('ServiceStarted', { service: 'order-service' });
    
    console.log('========================================');
    console.log('  ORDER SERVICE - Ready!');
    console.log(`  HTTP API: http://0.0.0.0:${HTTP_PORT}`);
    console.log(`  WebSocket: ws://0.0.0.0:${HTTP_PORT}/ws`);
    console.log('========================================');
    
    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n[Shutdown] Received shutdown signal...');
      trackEvent('ServiceStopping', { service: 'order-service' });
      
      await stopInventoryEventsConsumer();
      await closeServiceBus();
      
      server.close(() => {
        console.log('[Shutdown] HTTP server stopped');
        process.exit(0);
      });
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
  } catch (error) {
    console.error('[FATAL] Failed to start service:', error);
    process.exit(1);
  }
}

main();
