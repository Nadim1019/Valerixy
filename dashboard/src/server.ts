import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { initWebSocket } from './websocket';
import { startMetricsConsumer, stopMetricsConsumer } from './metricsConsumer';
import routes from './routes';

const app = express();
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3003', 10);

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', routes);

// Serve static frontend in production
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
});

async function main() {
  try {
    console.log('========================================');
    console.log('  DASHBOARD - Starting...');
    console.log('========================================');
    
    // Create HTTP server
    const server = http.createServer(app);
    
    // Initialize WebSocket
    initWebSocket(server);
    
    // Start ASB metrics consumer
    console.log('[ASB] Starting metrics consumer...');
    await startMetricsConsumer();
    
    // Start HTTP server
    server.listen(HTTP_PORT, () => {
      console.log(`[HTTP] Server running on port ${HTTP_PORT}`);
    });
    
    console.log('========================================');
    console.log('  DASHBOARD - Ready!');
    console.log(`  HTTP: http://0.0.0.0:${HTTP_PORT}`);
    console.log(`  WebSocket: ws://0.0.0.0:${HTTP_PORT}/ws`);
    console.log('========================================');
    
    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n[Shutdown] Received shutdown signal...');
      await stopMetricsConsumer();
      server.close(() => {
        console.log('[Shutdown] Server stopped');
        process.exit(0);
      });
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
  } catch (error) {
    console.error('[FATAL] Failed to start dashboard:', error);
    process.exit(1);
  }
}

main();
