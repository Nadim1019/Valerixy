import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as stockRepository from '../domain/stockRepository';
import { applyGremlinLatency, shouldSimulateCrash, simulateCrash } from '../middleware/gremlin';
import {
  publishInventoryEvent,
  publishMetricEvent,
  generateEventId,
} from '../publishers/inventoryPublisher';
import { trackException, trackEvent, trackMetric } from '../telemetry';

// Load proto - use environment variable or default to container path
const PROTO_PATH = process.env.PROTO_PATH || '/app/protos/inventory.proto';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const inventoryProto = grpc.loadPackageDefinition(packageDefinition).inventory as any;

// Handler implementations
async function reserveStock(
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>
): Promise<void> {
  const startTime = Date.now();
  const { orderId, productId, quantity, idempotencyKey } = call.request;
  
  console.log(`[gRPC] ReserveStock request: order=${orderId}, product=${productId}, qty=${quantity}`);
  
  try {
    // Apply Gremlin latency if enabled
    const latencyApplied = await applyGremlinLatency();
    
    // Process the reservation
    const result = await stockRepository.reserveStock(
      orderId,
      productId,
      quantity,
      idempotencyKey || undefined
    );
    
    // Check for Schrödinger crash (after DB commit, before response)
    if (result.success && shouldSimulateCrash()) {
      // The reservation is committed, but we'll crash before responding
      // The Order Service will timeout and send a VerifyOrder message
      simulateCrash();
    }
    
    // Publish event to ASB
    if (result.success && result.status !== 'already_exists') {
      await publishInventoryEvent({
        eventType: 'StockReserved',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId,
          productId,
          quantity,
          remainingStock: result.remainingStock!,
          reservationId: result.reservationId!,
        },
      });
      
      // Check for low stock alert
      const product = await stockRepository.getProduct(productId);
      if (product && product.stock <= product.lowStockThreshold) {
        await publishInventoryEvent({
          eventType: 'LowStockAlert',
          eventId: generateEventId(),
          timestamp: new Date().toISOString(),
          data: {
            productId,
            currentStock: product.stock,
            threshold: product.lowStockThreshold,
          },
        });
      }
    }
    
    // Map status to proto enum
    const statusMap: Record<string, number> = {
      confirmed: 1,
      insufficient_stock: 2,
      product_not_found: 3,
      already_exists: 4,
    };
    
    const duration = Date.now() - startTime;
    trackMetric('ReserveStock.Duration', duration);
    
    // Publish metric
    await publishMetricEvent({
      eventType: 'ResponseTime',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        service: 'inventory-service',
        operation: 'ReserveStock',
        durationMs: duration,
        success: result.success,
      },
    });
    
    callback(null, {
      success: result.success,
      message: result.message,
      reservationId: result.reservationId || '',
      remainingStock: result.remainingStock || 0,
      status: statusMap[result.status] || 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    trackException(error as Error, { operation: 'ReserveStock', orderId, productId });
    
    // Publish error metric
    await publishMetricEvent({
      eventType: 'ResponseTime',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        service: 'inventory-service',
        operation: 'ReserveStock',
        durationMs: duration,
        success: false,
      },
    });
    
    callback({
      code: grpc.status.INTERNAL,
      message: (error as Error).message,
    });
  }
}

async function releaseStock(
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>
): Promise<void> {
  const startTime = Date.now();
  const { orderId, reservationId, reason } = call.request;
  
  console.log(`[gRPC] ReleaseStock request: order=${orderId}, reservation=${reservationId}`);
  
  try {
    await applyGremlinLatency();
    
    const result = await stockRepository.releaseStock(orderId, reservationId, reason);
    
    if (result.success) {
      // Get product info for the event
      await publishInventoryEvent({
        eventType: 'StockReleased',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId,
          productId: 'unknown', // Would need to get from reservation
          quantity: 0, // Would need to get from reservation
          newStock: result.newStock!,
          reason,
        },
      });
    }
    
    const duration = Date.now() - startTime;
    trackMetric('ReleaseStock.Duration', duration);
    
    callback(null, {
      success: result.success,
      message: result.message,
      newStock: result.newStock || 0,
    });
  } catch (error) {
    trackException(error as Error, { operation: 'ReleaseStock', orderId, reservationId });
    callback({
      code: grpc.status.INTERNAL,
      message: (error as Error).message,
    });
  }
}

async function checkStock(
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>
): Promise<void> {
  const { productId } = call.request;
  
  console.log(`[gRPC] CheckStock request: product=${productId}`);
  
  try {
    await applyGremlinLatency();
    
    const product = await stockRepository.getProduct(productId);
    
    if (!product) {
      callback(null, {
        found: false,
        productId,
        productName: '',
        availableStock: 0,
        reservedStock: 0,
      });
      return;
    }
    
    callback(null, {
      found: true,
      productId: product.id,
      productName: product.name,
      availableStock: product.stock,
      reservedStock: 0, // Would need to calculate from active reservations
    });
  } catch (error) {
    trackException(error as Error, { operation: 'CheckStock', productId });
    callback({
      code: grpc.status.INTERNAL,
      message: (error as Error).message,
    });
  }
}

async function healthCheck(
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>
): Promise<void> {
  try {
    const dbHealthy = await stockRepository.checkDatabaseHealth();
    
    callback(null, {
      healthy: dbHealthy,
      message: dbHealthy ? 'All systems operational' : 'Database unhealthy',
      dependencies: {
        database: dbHealthy ? 'ok' : 'error',
        serviceBus: 'ok', // Would need actual check
      },
    });
  } catch (error) {
    callback(null, {
      healthy: false,
      message: (error as Error).message,
      dependencies: {
        database: 'error',
      },
    });
  }
}

// Create and start gRPC server
export function createGrpcServer(): grpc.Server {
  const server = new grpc.Server();
  
  server.addService(inventoryProto.InventoryService.service, {
    reserveStock,
    releaseStock,
    checkStock,
    healthCheck,
  });
  
  return server;
}

export function startGrpcServer(server: grpc.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          reject(error);
          return;
        }
        console.log(`[gRPC] Server listening on port ${port}`);
        resolve();
      }
    );
  });
}
