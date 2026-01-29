import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { trackDependency, trackException } from '../telemetry';

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

const GRPC_TIMEOUT_MS = 2000; // 2 second timeout as per requirements
const INVENTORY_SERVICE_HOST = process.env.INVENTORY_SERVICE_HOST || 'inventory-service:50051';

let client: any = null;

function getClient(): any {
  if (!client) {
    client = new inventoryProto.InventoryService(
      INVENTORY_SERVICE_HOST,
      grpc.credentials.createInsecure()
    );
  }
  return client;
}

export interface ReserveStockRequest {
  orderId: string;
  productId: string;
  quantity: number;
  idempotencyKey?: string;
}

export interface ReserveStockResponse {
  success: boolean;
  message: string;
  reservationId: string;
  remainingStock: number;
  status: 'UNKNOWN' | 'CONFIRMED' | 'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'ALREADY_EXISTS';
}

export interface ReleaseStockRequest {
  orderId: string;
  reservationId: string;
  reason: string;
}

export interface ReleaseStockResponse {
  success: boolean;
  message: string;
  newStock: number;
}

export interface CheckStockResponse {
  found: boolean;
  productId: string;
  productName: string;
  availableStock: number;
  reservedStock: number;
}

const statusMap: Record<number, ReserveStockResponse['status']> = {
  0: 'UNKNOWN',
  1: 'CONFIRMED',
  2: 'INSUFFICIENT_STOCK',
  3: 'PRODUCT_NOT_FOUND',
  4: 'ALREADY_EXISTS',
};

export async function reserveStock(request: ReserveStockRequest): Promise<ReserveStockResponse> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + GRPC_TIMEOUT_MS);
    
    getClient().reserveStock(request, { deadline }, (error: any, response: any) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        trackDependency(
          'ReserveStock',
          'gRPC',
          INVENTORY_SERVICE_HOST,
          duration,
          false
        );
        
        if (error.code === grpc.status.DEADLINE_EXCEEDED) {
          trackException(new Error('gRPC timeout'), { operation: 'ReserveStock' });
          reject(new Error('TIMEOUT'));
        } else if (error.code === grpc.status.UNAVAILABLE) {
          trackException(new Error('gRPC unavailable'), { operation: 'ReserveStock' });
          reject(new Error('UNAVAILABLE'));
        } else {
          trackException(error, { operation: 'ReserveStock' });
          reject(error);
        }
        return;
      }
      
      trackDependency(
        'ReserveStock',
        'gRPC',
        INVENTORY_SERVICE_HOST,
        duration,
        true
      );
      
      resolve({
        success: response.success,
        message: response.message,
        reservationId: response.reservationId,
        remainingStock: response.remainingStock,
        status: statusMap[response.status] || 'UNKNOWN',
      });
    });
  });
}

export async function releaseStock(request: ReleaseStockRequest): Promise<ReleaseStockResponse> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + GRPC_TIMEOUT_MS);
    
    getClient().releaseStock(request, { deadline }, (error: any, response: any) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        trackDependency('ReleaseStock', 'gRPC', INVENTORY_SERVICE_HOST, duration, false);
        
        if (error.code === grpc.status.DEADLINE_EXCEEDED) {
          reject(new Error('TIMEOUT'));
        } else {
          reject(error);
        }
        return;
      }
      
      trackDependency('ReleaseStock', 'gRPC', INVENTORY_SERVICE_HOST, duration, true);
      
      resolve({
        success: response.success,
        message: response.message,
        newStock: response.newStock,
      });
    });
  });
}

export async function checkStock(productId: string): Promise<CheckStockResponse> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + GRPC_TIMEOUT_MS);
    
    getClient().checkStock({ productId }, { deadline }, (error: any, response: any) => {
      const duration = Date.now() - startTime;
      
      if (error) {
        trackDependency('CheckStock', 'gRPC', INVENTORY_SERVICE_HOST, duration, false);
        reject(error);
        return;
      }
      
      trackDependency('CheckStock', 'gRPC', INVENTORY_SERVICE_HOST, duration, true);
      
      resolve({
        found: response.found,
        productId: response.productId,
        productName: response.productName,
        availableStock: response.availableStock,
        reservedStock: response.reservedStock,
      });
    });
  });
}

export async function healthCheck(): Promise<{ healthy: boolean; message: string }> {
  return new Promise((resolve) => {
    const deadline = new Date(Date.now() + 1000);
    
    getClient().healthCheck({}, { deadline }, (error: any, response: any) => {
      if (error) {
        resolve({ healthy: false, message: error.message });
        return;
      }
      
      resolve({
        healthy: response.healthy,
        message: response.message,
      });
    });
  });
}
