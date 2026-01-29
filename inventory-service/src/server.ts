import express from 'express';
import cors from 'cors';
import { initTelemetry, trackEvent } from './telemetry';
import { createGrpcServer, startGrpcServer } from './handlers/inventoryHandler';
import routes from './interface/routes';
import { initPool } from './domain/stockRepository';
import { startVerifyOrderConsumer } from './consumers/verifyOrderConsumer';
import { initializePublisher } from './publishers/inventoryPublisher';

// Initialize telemetry first
initTelemetry();

const app = express();
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3002', 10);
const GRPC_PORT = parseInt(process.env.GRPC_PORT || '50051', 10);

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
    console.log('  INVENTORY SERVICE - Starting...');
    console.log('========================================');
    
    // Initialize database connection pool
    console.log('[DB] Initializing connection pool...');
    await initPool();
    console.log('[DB] Connection pool ready');
    
    // Create and start gRPC server
    console.log('[gRPC] Starting gRPC server...');
    const grpcServer = createGrpcServer();
    await startGrpcServer(grpcServer, GRPC_PORT);
    console.log(`[gRPC] Server running on port ${GRPC_PORT}`);
    
    // Start HTTP server
    app.listen(HTTP_PORT, () => {
      console.log(`[HTTP] Server running on port ${HTTP_PORT}`);
    });
    
    // Start ASB consumer for verify-orders queue
    console.log('[ASB] Starting VerifyOrder consumer...');
    await startVerifyOrderConsumer();
    console.log('[ASB] Consumer started');
    
    // Initialize ASB publisher for inventory-events topic
    console.log('[ASB] Initializing inventory events publisher...');
    await initializePublisher();
    console.log('[ASB] Publisher initialized');
    
    trackEvent('ServiceStarted', { service: 'inventory-service' });
    
    console.log('========================================');
    console.log('  INVENTORY SERVICE - Ready!');
    console.log(`  HTTP API: http://0.0.0.0:${HTTP_PORT}`);
    console.log(`  gRPC: 0.0.0.0:${GRPC_PORT}`);
    console.log('========================================');
    
    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n[Shutdown] Received shutdown signal...');
      trackEvent('ServiceStopping', { service: 'inventory-service' });
      
      grpcServer.forceShutdown();
      console.log('[Shutdown] gRPC server stopped');
      
      process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
  } catch (error) {
    console.error('[FATAL] Failed to start service:', error);
    process.exit(1);
  }
}

main();
