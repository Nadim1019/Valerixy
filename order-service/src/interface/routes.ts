import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as orderRepository from '../domain/orderRepository';
import * as inventoryClient from '../clients/inventoryClient';
import {
  publishOrderEvent,
  sendVerifyOrderMessage,
  generateEventId,
} from '../messaging/orderPublisher';
import { broadcastOrderUpdate, getConnectedClientsCount } from './websocket';
import { trackEvent, trackMetric, trackException } from '../telemetry';

const router = Router();
const INVENTORY_HTTP_URL = process.env.INVENTORY_HTTP_URL || 'http://inventory-service:3002';

/**
 * GET /products
 * Proxy to inventory service - list all products
 */
router.get('/products', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${INVENTORY_HTTP_URL}/products`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[API] Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /orders
 * Create a new order
 */
router.post('/orders', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { customerId, productId, quantity, idempotencyKey: bodyIdempotencyKey } = req.body;
  
  // Support idempotency key from header (standard) or body
  const idempotencyKey = (req.headers['idempotency-key'] as string) || bodyIdempotencyKey;
  
  // Validation
  if (!customerId || !productId || !quantity) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: customerId, productId, quantity',
    });
  }
  
  if (quantity <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Quantity must be positive',
    });
  }
  
  const requestIdempotencyKey = idempotencyKey || uuidv4();
  
  try {
    // Check for existing order with idempotency key
    if (idempotencyKey) {
      const existingOrder = await orderRepository.getOrderByIdempotencyKey(idempotencyKey);
      if (existingOrder) {
        console.log(`[API] Returning existing order for idempotency key: ${idempotencyKey}`);
        return res.status(200).json({
          success: true,
          data: existingOrder,
          cached: true,
        });
      }
    }
    
    // Create the order
    const order = await orderRepository.createOrder({
      customerId,
      productId,
      quantity,
      idempotencyKey: requestIdempotencyKey,
    });
    
    console.log(`[API] Order created: ${order.id}`);
    
    // Publish order created event
    await publishOrderEvent({
      eventType: 'OrderCreated',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        orderId: order.id,
        customerId,
        productId,
        quantity,
        status: 'pending',
      },
    });
    
    // Try to reserve stock via gRPC
    let reservationResult;
    let timedOut = false;
    
    try {
      reservationResult = await inventoryClient.reserveStock({
        orderId: order.id,
        productId,
        quantity,
        idempotencyKey: requestIdempotencyKey,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;
      
      if (errorMessage === 'TIMEOUT' || errorMessage === 'UNAVAILABLE') {
        timedOut = true;
        console.log(`[API] gRPC ${errorMessage} for order ${order.id}`);
      } else {
        throw error;
      }
    }
    
    if (timedOut) {
      // Schrödinger case: we don't know if reservation succeeded
      // Mark order as pending_verification and send verify message
      await orderRepository.updateOrderStatus(order.id, 'pending_verification');
      
      await sendVerifyOrderMessage({
        eventType: 'VerifyOrder',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId: order.id,
          productId,
          quantity,
          idempotencyKey: requestIdempotencyKey,
          originalRequestTime: new Date().toISOString(),
        },
      });
      
      await publishOrderEvent({
        eventType: 'OrderPendingVerification',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId: order.id,
          productId,
          quantity,
          status: 'pending_verification',
          reason: 'gRPC timeout - verification required',
        },
      });
      
      trackEvent('OrderPendingVerification', { orderId: order.id });
      
      const updatedOrder = await orderRepository.getOrder(order.id);
      
      return res.status(202).json({
        success: true,
        data: updatedOrder,
        message: 'Order is being verified. Please check status later.',
        verificationRequired: true,
      });
    }
    
    // Process reservation result
    if (reservationResult!.success) {
      await orderRepository.updateOrderStatus(
        order.id,
        'confirmed',
        reservationResult!.reservationId
      );
      
      await publishOrderEvent({
        eventType: 'OrderConfirmed',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId: order.id,
          status: 'confirmed',
          reservationId: reservationResult!.reservationId,
        },
      });
      
      broadcastOrderUpdate({
        orderId: order.id,
        status: 'confirmed',
        reservationId: reservationResult!.reservationId,
      });
      
      trackEvent('OrderConfirmed', { orderId: order.id });
      
      const confirmedOrder = await orderRepository.getOrder(order.id);
      
      const duration = Date.now() - startTime;
      trackMetric('OrderCreation.Duration', duration);
      
      return res.status(201).json({
        success: true,
        data: confirmedOrder,
      });
    } else {
      // Reservation failed (insufficient stock, product not found, etc.)
      await orderRepository.updateOrderStatus(
        order.id,
        'failed',
        undefined,
        reservationResult!.message
      );
      
      await publishOrderEvent({
        eventType: 'OrderFailed',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId: order.id,
          status: 'failed',
          reason: reservationResult!.message,
        },
      });
      
      broadcastOrderUpdate({
        orderId: order.id,
        status: 'failed',
        message: reservationResult!.message,
      });
      
      trackEvent('OrderFailed', { orderId: order.id, reason: reservationResult!.status });
      
      const failedOrder = await orderRepository.getOrder(order.id);
      
      return res.status(400).json({
        success: false,
        data: failedOrder,
        error: reservationResult!.message,
      });
    }
  } catch (error) {
    console.error('[API] Error creating order:', error);
    trackException(error as Error, { operation: 'CreateOrder' });
    
    return res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /orders/:id
 * Get order by ID
 */
router.get('/orders/:id', async (req: Request, res: Response) => {
  try {
    const order = await orderRepository.getOrder(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }
    
    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('[API] Error fetching order:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /orders
 * List orders (with optional status filter)
 */
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string || '100', 10);
    
    const orders = await orderRepository.getOrders(
      status as any,
      limit
    );
    
    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
  } catch (error) {
    console.error('[API] Error listing orders:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /orders/:id/cancel
 * Cancel an order
 */
router.post('/orders/:id/cancel', async (req: Request, res: Response) => {
  try {
    const order = await orderRepository.getOrder(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }
    
    if (order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Order is already cancelled',
      });
    }
    
    if (order.status === 'failed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot cancel a failed order',
      });
    }
    
    // If order was confirmed, release the stock
    if (order.status === 'confirmed' && order.reservationId) {
      try {
        await inventoryClient.releaseStock({
          orderId: order.id,
          reservationId: order.reservationId,
          reason: 'Order cancelled by user',
        });
      } catch (error) {
        console.error('[API] Failed to release stock:', error);
        // Continue with cancellation even if release fails
      }
    }
    
    await orderRepository.updateOrderStatus(order.id, 'cancelled');
    
    await publishOrderEvent({
      eventType: 'OrderCancelled',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        orderId: order.id,
        status: 'cancelled',
        reason: 'Cancelled by user',
      },
    });
    
    broadcastOrderUpdate({
      orderId: order.id,
      status: 'cancelled',
    });
    
    const cancelledOrder = await orderRepository.getOrder(order.id);
    
    res.json({
      success: true,
      data: cancelledOrder,
    });
  } catch (error) {
    console.error('[API] Error cancelling order:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /products/:id/stock
 * Check stock for a product (proxy to inventory service)
 */
router.get('/products/:id/stock', async (req: Request, res: Response) => {
  try {
    const result = await inventoryClient.checkStock(req.params.id);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[API] Error checking stock:', error);
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
    const dbHealthy = await orderRepository.checkDatabaseHealth();
    const inventoryHealth = await inventoryClient.healthCheck();
    
    const status = dbHealthy && inventoryHealth.healthy ? 'healthy' : 'degraded';
    
    res.status(dbHealthy ? 200 : 503).json({
      service: 'order-service',
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealthy ? 'ok' : 'error',
        inventory: inventoryHealth.healthy ? 'ok' : 'error',
      },
      websocket: {
        connectedClients: getConnectedClientsCount(),
      },
    });
  } catch (error) {
    res.status(503).json({
      service: 'order-service',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: (error as Error).message,
    });
  }
});

export default router;
