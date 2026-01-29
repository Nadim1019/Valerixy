import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

export interface Order {
  id: string;
  customerId: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'reserved' | 'confirmed' | 'failed' | 'pending_verification' | 'cancelled';
  idempotencyKey?: string;
  reservationId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export interface CreateOrderInput {
  customerId: string;
  productId: string;
  quantity: number;
  idempotencyKey?: string;
}

let pool: Pool;

export async function initPool(): Promise<void> {
  pool = new Pool({
    host: process.env.DB_HOST || 'order-db',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'order_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  
  // Test connection
  const client = await pool.connect();
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

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const pool = await getPool();
  const id = uuidv4();
  
  // Check for existing order with same idempotency key
  if (input.idempotencyKey) {
    const existing = await pool.query(
      'SELECT * FROM orders WHERE idempotency_key = $1',
      [input.idempotencyKey]
    );
    
    if (existing.rows.length > 0) {
      return mapRowToOrder(existing.rows[0]);
    }
  }
  
  const result = await pool.query(
    `INSERT INTO orders (id, customer_id, product_id, quantity, status, idempotency_key)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING *`,
    [id, input.customerId, input.productId, input.quantity, input.idempotencyKey]
  );
  
  // Record event
  await pool.query(
    `INSERT INTO order_events (order_id, event_type, event_data)
     VALUES ($1, 'OrderCreated', $2)`,
    [id, JSON.stringify(input)]
  );
  
  return mapRowToOrder(result.rows[0]);
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const pool = await getPool();
  const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return mapRowToOrder(result.rows[0]);
}

export async function getOrderByIdempotencyKey(key: string): Promise<Order | null> {
  const pool = await getPool();
  const result = await pool.query(
    'SELECT * FROM orders WHERE idempotency_key = $1',
    [key]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return mapRowToOrder(result.rows[0]);
}

export async function updateOrderStatus(
  orderId: string,
  status: Order['status'],
  reservationId?: string,
  errorMessage?: string
): Promise<Order | null> {
  const pool = await getPool();
  
  let query = 'UPDATE orders SET status = $1';
  const params: any[] = [status];
  let paramIndex = 2;
  
  if (reservationId !== undefined) {
    query += `, reservation_id = $${paramIndex}`;
    params.push(reservationId);
    paramIndex++;
  }
  
  if (errorMessage !== undefined) {
    query += `, error_message = $${paramIndex}`;
    params.push(errorMessage);
    paramIndex++;
  }
  
  if (status === 'confirmed' || status === 'failed' || status === 'cancelled') {
    query += `, completed_at = CURRENT_TIMESTAMP`;
  }
  
  query += ` WHERE id = $${paramIndex} RETURNING *`;
  params.push(orderId);
  
  const result = await pool.query(query, params);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  // Record event
  await pool.query(
    `INSERT INTO order_events (order_id, event_type, event_data)
     VALUES ($1, $2, $3)`,
    [orderId, `Status_${status}`, JSON.stringify({ reservationId, errorMessage })]
  );
  
  return mapRowToOrder(result.rows[0]);
}

export async function getOrders(
  status?: Order['status'],
  limit: number = 100
): Promise<Order[]> {
  const pool = await getPool();
  
  let query = 'SELECT * FROM orders';
  const params: any[] = [];
  
  if (status) {
    query += ' WHERE status = $1';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);
  
  const result = await pool.query(query, params);
  return result.rows.map(mapRowToOrder);
}

export async function getPendingVerificationOrders(): Promise<Order[]> {
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM orders 
     WHERE status = 'pending_verification' 
     ORDER BY created_at ASC`
  );
  return result.rows.map(mapRowToOrder);
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const pool = await getPool();
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

function mapRowToOrder(row: any): Order {
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    quantity: row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    reservationId: row.reservation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}
