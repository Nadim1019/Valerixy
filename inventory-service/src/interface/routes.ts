import { Router, Request, Response } from 'express';
import * as stockRepository from '../domain/stockRepository';
import { getGremlinStatus, setGremlinLatency, setSchrödingerCrash } from '../middleware/gremlin';
import { trackEvent } from '../telemetry';

const router = Router();

/**
 * GET /products
 * List all products with stock information
 */
router.get('/products', async (req: Request, res: Response) => {
  try {
    const products = await stockRepository.getAllProducts();
    res.json({
      success: true,
      data: products,
      count: products.length,
    });
  } catch (error) {
    console.error('[API] Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /products/:id
 * Get a specific product by ID
 */
router.get('/products/:id', async (req: Request, res: Response) => {
  try {
    const product = await stockRepository.getProduct(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      });
    }
    
    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error('[API] Error fetching product:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const dbHealthy = await stockRepository.checkDatabaseHealth();
    const gremlinStatus = getGremlinStatus();
    
    const status = dbHealthy ? 'healthy' : 'unhealthy';
    
    res.status(dbHealthy ? 200 : 503).json({
      service: 'inventory-service',
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealthy ? 'ok' : 'error',
        gremlin: gremlinStatus,
      },
    });
  } catch (error) {
    res.status(503).json({
      service: 'inventory-service',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
});

/**
 * POST /chaos/gremlin
 * Enable/disable Gremlin latency injection
 */
router.post('/chaos/gremlin', (req: Request, res: Response) => {
  const { enabled, minLatencyMs, maxLatencyMs } = req.body;
  
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'enabled must be a boolean',
    });
  }
  
  setGremlinLatency(enabled, minLatencyMs, maxLatencyMs);
  
  trackEvent('ChaosGremlinToggled', { enabled: String(enabled) });
  
  console.log(`[Chaos] Gremlin latency ${enabled ? 'enabled' : 'disabled'}`);
  
  res.json({
    success: true,
    message: `Gremlin latency ${enabled ? 'enabled' : 'disabled'}`,
    config: {
      enabled,
      minLatencyMs: minLatencyMs || 2000,
      maxLatencyMs: maxLatencyMs || 5000,
    },
  });
});

/**
 * POST /chaos/schrodinger
 * Enable/disable Schrödinger crash simulation
 */
router.post('/chaos/schrodinger', (req: Request, res: Response) => {
  const { enabled, probability } = req.body;
  
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'enabled must be a boolean',
    });
  }
  
  setSchrödingerCrash(enabled, probability);
  
  trackEvent('ChaosSchrödingerToggled', { enabled: String(enabled) });
  
  console.log(`[Chaos] Schrödinger crash ${enabled ? 'enabled' : 'disabled'}`);
  
  res.json({
    success: true,
    message: `Schrödinger crash ${enabled ? 'enabled' : 'disabled'}`,
    config: {
      enabled,
      probability: probability || 0.3,
    },
  });
});

/**
 * GET /chaos/status
 * Get current chaos engineering status
 */
router.get('/chaos/status', (req: Request, res: Response) => {
  const status = getGremlinStatus();
  
  res.json({
    success: true,
    data: status,
  });
});

export default router;
