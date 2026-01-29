import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { trackException, trackEvent } from '../telemetry';

// Types
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  lowStockThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Reservation {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  status: 'active' | 'released' | 'committed';
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReserveResult {
  success: boolean;
  message: string;
  reservationId?: string;
  remainingStock?: number;
  status: 'confirmed' | 'insufficient_stock' | 'product_not_found' | 'already_exists';
}

export interface ReleaseResult {
  success: boolean;
  message: string;
  newStock?: number;
}

// Database connection pool
let pool: Pool;

export async function initPool(): Promise<void> {
  pool = new Pool({
    host: process.env.DB_HOST || 'inventory-db',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'inventory_db',
    user: process.env.DB_USER || 'inventory_admin',
    password: process.env.DB_PASSWORD || 'inventory_secret',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client', err);
    trackException(err, { context: 'pool_error' });
  });

  // Test connection
  const client = await (await getPool()).connect();
  await client.query('SELECT 1');
  client.release();
  console.log('[DB] Connection pool initialized');
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    await initPool();
  }
  return pool;
}

// Repository functions
export async function getProduct(productId: string): Promise<Product | null> {
  try {
    const p = await getPool();
    const result = await p.query(
      'SELECT * FROM products WHERE id = $1',
      [productId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      stock: row.stock,
      lowStockThreshold: row.low_stock_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    trackException(error as Error, { operation: 'getProduct', productId });
    throw error;
  }
}

export async function getAllProducts(): Promise<Product[]> {
  try {
    const result = await (await getPool()).query('SELECT * FROM products ORDER BY name');
    
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      stock: row.stock,
      lowStockThreshold: row.low_stock_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    trackException(error as Error, { operation: 'getAllProducts' });
    throw error;
  }
}

export async function reserveStock(
  orderId: string,
  productId: string,
  quantity: number,
  idempotencyKey?: string
): Promise<ReserveResult> {
  const client = await (await getPool()).connect();
  
  try {
    await client.query('BEGIN');
    
    // Check for existing reservation with same idempotency key
    if (idempotencyKey) {
      const existingRes = await client.query(
        'SELECT * FROM reservations WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      
      if (existingRes.rows.length > 0) {
        await client.query('ROLLBACK');
        const existing = existingRes.rows[0];
        return {
          success: true,
          message: 'Reservation already exists (idempotent)',
          reservationId: existing.id,
          status: 'already_exists',
        };
      }
    }
    
    // Lock the product row for update
    const productResult = await client.query(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    
    if (productResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Product ${productId} not found`,
        status: 'product_not_found',
      };
    }
    
    const product = productResult.rows[0];
    const currentStock = product.stock;
    
    if (currentStock < quantity) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
        remainingStock: currentStock,
        status: 'insufficient_stock',
      };
    }
    
    // Deduct stock
    const newStock = currentStock - quantity;
    await client.query(
      'UPDATE products SET stock = $1 WHERE id = $2',
      [newStock, productId]
    );
    
    // Create reservation
    const reservationId = uuidv4();
    await client.query(
      `INSERT INTO reservations (id, order_id, product_id, quantity, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'active', $5)`,
      [reservationId, orderId, productId, quantity, idempotencyKey]
    );
    
    // Audit log
    await client.query(
      `INSERT INTO stock_audit_log (product_id, operation, quantity_change, previous_stock, new_stock, order_id, reservation_id, reason)
       VALUES ($1, 'reserve', $2, $3, $4, $5, $6, 'order_reservation')`,
      [productId, -quantity, currentStock, newStock, orderId, reservationId]
    );
    
    await client.query('COMMIT');
    
    trackEvent('StockReserved', {
      orderId,
      productId,
      quantity: quantity.toString(),
      reservationId,
      remainingStock: newStock.toString(),
    });
    
    return {
      success: true,
      message: 'Stock reserved successfully',
      reservationId,
      remainingStock: newStock,
      status: 'confirmed',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    trackException(error as Error, { operation: 'reserveStock', orderId, productId });
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseStock(
  orderId: string,
  reservationId: string,
  reason: string
): Promise<ReleaseResult> {
  const client = await (await getPool()).connect();
  
  try {
    await client.query('BEGIN');
    
    // Find and lock the reservation
    const resResult = await client.query(
      'SELECT * FROM reservations WHERE id = $1 AND order_id = $2 FOR UPDATE',
      [reservationId, orderId]
    );
    
    if (resResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: 'Reservation not found',
      };
    }
    
    const reservation = resResult.rows[0];
    
    if (reservation.status !== 'active') {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Reservation already ${reservation.status}`,
      };
    }
    
    // Lock product and restore stock
    const productResult = await client.query(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE',
      [reservation.product_id]
    );
    
    const currentStock = productResult.rows[0].stock;
    const newStock = currentStock + reservation.quantity;
    
    await client.query(
      'UPDATE products SET stock = $1 WHERE id = $2',
      [newStock, reservation.product_id]
    );
    
    // Update reservation status
    await client.query(
      `UPDATE reservations SET status = 'released' WHERE id = $1`,
      [reservationId]
    );
    
    // Audit log
    await client.query(
      `INSERT INTO stock_audit_log (product_id, operation, quantity_change, previous_stock, new_stock, order_id, reservation_id, reason)
       VALUES ($1, 'release', $2, $3, $4, $5, $6, $7)`,
      [reservation.product_id, reservation.quantity, currentStock, newStock, orderId, reservationId, reason]
    );
    
    await client.query('COMMIT');
    
    trackEvent('StockReleased', {
      orderId,
      reservationId,
      productId: reservation.product_id,
      quantity: reservation.quantity.toString(),
      newStock: newStock.toString(),
      reason,
    });
    
    return {
      success: true,
      message: 'Stock released successfully',
      newStock,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    trackException(error as Error, { operation: 'releaseStock', orderId, reservationId });
    throw error;
  } finally {
    client.release();
  }
}

export async function findReservationByOrderId(orderId: string): Promise<Reservation | null> {
  try {
    const result = await (await getPool()).query(
      'SELECT * FROM reservations WHERE order_id = $1 AND status = $2',
      [orderId, 'active']
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      id: row.id,
      orderId: row.order_id,
      productId: row.product_id,
      quantity: row.quantity,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    trackException(error as Error, { operation: 'findReservationByOrderId', orderId });
    throw error;
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await (await getPool()).query('SELECT 1');
    return true;
  } catch (error) {
    trackException(error as Error, { operation: 'checkDatabaseHealth' });
    return false;
  }
}

export { pool };
