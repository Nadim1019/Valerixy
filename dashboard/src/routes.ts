import { Router, Request, Response } from 'express';
import { getMetricsStore, getConnectedClients } from './websocket';

const router = Router();

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3001';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3002';

/**
 * GET /health
 * Dashboard health check
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    service: 'dashboard',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    websocket: {
      connectedClients: getConnectedClients(),
    },
  });
});

/**
 * GET /metrics
 * Get current metrics snapshot
 */
router.get('/metrics', (req: Request, res: Response) => {
  const metrics = getMetricsStore();
  res.json({
    success: true,
    data: metrics,
  });
});

/**
 * GET /services/health
 * Check health of all services
 */
router.get('/services/health', async (req: Request, res: Response) => {
  const results: Record<string, any> = {};
  
  // Check Order Service
  try {
    const response = await fetch(`${ORDER_SERVICE_URL}/health`);
    results['order-service'] = await response.json();
  } catch (error) {
    results['order-service'] = {
      status: 'unhealthy',
      error: (error as Error).message,
    };
  }
  
  // Check Inventory Service
  try {
    const response = await fetch(`${INVENTORY_SERVICE_URL}/health`);
    results['inventory-service'] = await response.json();
  } catch (error) {
    results['inventory-service'] = {
      status: 'unhealthy',
      error: (error as Error).message,
    };
  }
  
  res.json({
    success: true,
    data: results,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /chaos/gremlin
 * Toggle Gremlin latency on Inventory Service
 */
router.post('/chaos/gremlin', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${INVENTORY_SERVICE_URL}/chaos/gremlin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    
    const result = await response.json();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /chaos/schrodinger
 * Toggle Schrödinger crash on Inventory Service
 */
router.post('/chaos/schrodinger', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${INVENTORY_SERVICE_URL}/chaos/schrodinger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    
    const result = await response.json();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /chaos/status
 * Get chaos engineering status
 */
router.get('/chaos/status', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${INVENTORY_SERVICE_URL}/chaos/status`);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

export default router;
