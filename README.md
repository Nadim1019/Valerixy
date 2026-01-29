# 📦 Valerix: Resilient E-Commerce Microservices

> **High-Reliability Order & Inventory Management System**  
> Built with TypeScript, gRPC, PostgreSQL, and Azure Service Bus

---

## 🎯 Project Overview

Valerix transforms a monolithic e-commerce platform into a **resilient microservices architecture** capable of handling:

- **Network latency** ("Gremlin Mode") - random delays in service responses
- **Process crashes** ("Schrödinger's Warehouse") - failures after DB commit but before response
- **High traffic loads** - thousands of orders per minute
- **Partial failures** - graceful degradation without cascading errors

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AZURE SERVICE BUS (Event Backbone)                   │
│                                                                             │
│   Topics:                                                                   │
│   ├── inventory-events    (stock updates, reservations, releases)          │
│   ├── order-events        (order created, shipped, cancelled)              │
│   └── system-metrics      (response times, errors, health events)          │
│                                                                             │
└─────────┬──────────────────────┬──────────────────────┬─────────────────────┘
          │ PUBLISH              │ SUBSCRIBE            │ SUBSCRIBE
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Inventory Service  │  │    Order Service    │  │     Dashboard       │
│     (PUBLISHER)     │  │    (SUBSCRIBER)     │  │    (SUBSCRIBER)     │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│                     │  │                     │  │                     │
│  ┌───────────────┐  │  │  ┌───────────────┐  │  │  Subscribes to:     │
│  │   /handlers   │  │  │  │  /interface   │  │  │  • inventory-events │
│  │    (gRPC)     │  │  │  │    (REST)     │  │  │  • order-events     │
│  └───────┬───────┘  │  │  └───────┬───────┘  │  │  • system-metrics   │
│          │          │  │          │          │  │                     │
│  ┌───────▼───────┐  │  │  ┌───────▼───────┐  │  │  Displays:          │
│  │    /domain    │  │  │  │    /domain    │  │  │  • Stock levels     │
│  │  (Stock Logic)│  │  │  │  (Validation) │  │  │  • Order status     │
│  └───────┬───────┘  │  │  └───────┬───────┘  │  │  • Health alerts    │
│          │          │  │          │          │  │  • Response times   │
│  ┌───────▼───────┐  │  │  ┌───────▼───────┐  │  │                     │
│  │  /publishers  │──┼──│  │  /consumers   │  │  │  🟢/🔴 Visual      │
│  │ (ASB Sender)  │  │  │  │ (ASB Receiver)│  │  │     Alerts          │
│  └───────────────┘  │  │  └───────────────┘  │  │                     │
│                     │  │                     │  │                     │
│  [Gremlin Mode]     │  │  [Timeout Handler]  │  │  [/health]          │
│  [/health]          │  │  [/health]          │  │                     │
└──────────┬──────────┘  └──────────┬──────────┘  └─────────────────────┘
           │                        │
           ▼                        ▼
   ┌───────────────┐        ┌───────────────┐
   │ Inventory DB  │        │   Order DB    │
   │ (PostgreSQL)  │        │ (PostgreSQL)  │
   │               │        │               │
   │ • products    │        │ • orders      │
   │ • stock       │        │ • order_items │
   │ • reservations│        │ • status_log  │
   └───────────────┘        └───────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMMUNICATION FLOW                                │
│                                                                             │
│   1. Order Service sends ReserveStock request → Inventory (gRPC, 2s timeout)│
│   2. Inventory processes & publishes StockReserved event → ASB             │
│   3. Order Service receives event via ASB subscription                      │
│   4. Dashboard receives same event via ASB subscription (real-time UI)      │
│   5. On gRPC timeout → Order publishes VerifyOrder to ASB for recovery      │
│                                                                             │
│   ⚠️  No direct service-to-service data queries!                           │
│   All inventory data flows through ASB events                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────────────────────────────┐
│   Frontend   │   REST  │         Order Service                │
│   (React)    │────────▶│  POST /api/orders                    │
└──────────────┘         │  GET  /api/orders/:id                │
                         │  GET  /health                        │
                         └──────────────────────────────────────┘
```

---

## � Azure Service Bus - Complete Workflow Guide

Azure Service Bus (ASB) is the **event backbone** of the Valerix architecture. It enables loose coupling, reliable messaging, and event-driven communication between all services.

### ASB Resource Structure

```
Azure Service Bus Namespace: valerix-ns
│
├── 📬 TOPICS (Pub/Sub - One-to-Many)
│   │
│   ├── inventory-events
│   │   ├── Subscription: order-service-sub      → Order Service
│   │   └── Subscription: dashboard-sub          → Dashboard Backend
│   │
│   ├── order-events  
│   │   └── Subscription: dashboard-sub          → Dashboard Backend
│   │
│   └── system-metrics
│       └── Subscription: dashboard-sub          → Dashboard Backend
│
└── 📥 QUEUES (Point-to-Point - One-to-One)
    │
    └── verify-orders                            → Inventory Service
        (Schrödinger recovery queue)
```

---

### Workflow 1: Happy Path - Successful Order

```
┌─────────┐      ┌───────────────┐      ┌───────────────────┐      ┌─────────────┐
│ Frontend│      │ Order Service │      │ Inventory Service │      │     ASB     │
└────┬────┘      └───────┬───────┘      └─────────┬─────────┘      └──────┬──────┘
     │                   │                        │                       │
     │ POST /api/orders  │                        │                       │
     │──────────────────▶│                        │                       │
     │                   │                        │                       │
     │                   │  gRPC: ReserveStock    │                       │
     │                   │  (2s timeout)          │                       │
     │                   │───────────────────────▶│                       │
     │                   │                        │                       │
     │                   │                        │ 1. Validate stock     │
     │                   │                        │ 2. BEGIN TRANSACTION  │
     │                   │                        │ 3. Deduct stock       │
     │                   │                        │ 4. Create reservation │
     │                   │                        │ 5. COMMIT             │
     │                   │                        │                       │
     │                   │                        │ PUBLISH: StockReserved│
     │                   │                        │──────────────────────▶│
     │                   │                        │                       │
     │                   │  gRPC Response: OK     │                       │
     │                   │◀───────────────────────│                       │
     │                   │                        │                       │
     │                   │ Save order (CONFIRMED) │                       │
     │                   │                        │                       │
     │  Response: 200 OK │                        │                       │
     │  {status:confirmed}                        │                       │
     │◀──────────────────│                        │                       │
     │                   │                        │                       │
     │                   │                        │          ┌────────────┴────────────┐
     │                   │                        │          │ Event: StockReserved    │
     │                   │                        │          │ {                       │
     │                   │                        │          │   orderId: "ORD-123",   │
     │                   │                        │          │   productId: "SKU-001", │
     │                   │                        │          │   quantity: 2,          │
     │                   │                        │          │   remainingStock: 48,   │
     │                   │                        │          │   timestamp: "..."      │
     │                   │                        │          │ }                       │
     │                   │                        │          └─────────────────────────┘
     │                   │                        │                       │
     │                   │                        │          FANOUT TO:   │
     │                   │                        │          • order-service-sub
     │                   │                        │          • dashboard-sub
```

---

### Workflow 2: Gremlin Mode - Timeout with Recovery

```
┌─────────┐      ┌───────────────┐      ┌───────────────────┐      ┌─────────────┐
│ Frontend│      │ Order Service │      │ Inventory Service │      │     ASB     │
└────┬────┘      └───────┬───────┘      └─────────┬─────────┘      └──────┬──────┘
     │                   │                        │                       │
     │ POST /api/orders  │                        │                       │
     │──────────────────▶│                        │                       │
     │                   │                        │                       │
     │                   │  gRPC: ReserveStock    │                       │
     │                   │  (2s timeout)          │                       │
     │                   │───────────────────────▶│                       │
     │                   │                        │                       │
     │                   │                        │ ⏳ GREMLIN_MODE=true  │
     │                   │                        │ Sleep 3-5 seconds...  │
     │                   │                        │                       │
     │                   │  ⚠️ DEADLINE_EXCEEDED  │                       │
     │                   │  (after 2s)            │                       │
     │                   │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                       │
     │                   │                        │                       │
     │                   │ PUBLISH: VerifyOrder   │                       │
     │                   │ to verify-orders QUEUE │                       │
     │                   │───────────────────────────────────────────────▶│
     │                   │                        │                       │
     │                   │ Save order (PENDING)   │                       │
     │                   │                        │                       │
     │  Response: 202    │                        │                       │
     │  {status:pending_ │                        │                       │
     │   verification}   │                        │                       │
     │◀──────────────────│                        │                       │
     │                   │                        │                       │
     │ 🔄 FRONTEND STARTS POLLING                 │                       │
     │ GET /api/orders/ORD-123                    │                       │
     │ (every 2 seconds) │                        │                       │
     │──────────────────▶│                        │                       │
     │                   │                        │                       │
     │  {status: pending}│                        │                       │
     │◀──────────────────│                        │                       │
     │                   │                        │                       │
     │                   │                        │ (Gremlin delay ends)  │
     │                   │                        │ Processes reservation │
     │                   │                        │ COMMIT to DB          │
     │                   │                        │                       │
     │                   │                        │ PUBLISH: StockReserved│
     │                   │                        │──────────────────────▶│
     │                   │                        │                       │
     │                   │                        │◀──────────────────────│
     │                   │                        │ CONSUME: VerifyOrder  │
     │                   │                        │ (from queue)          │
     │                   │                        │                       │
     │                   │                        │ Check: reservation    │
     │                   │                        │ already exists?       │
     │                   │                        │ YES → Acknowledge msg │
     │                   │                        │                       │
     │                   │                        │ PUBLISH: OrderVerified│
     │                   │                        │──────────────────────▶│
     │                   │                        │                       │
     │                   │◀──────────────────────────────────────────────│
     │                   │ CONSUME: OrderVerified │                       │
     │                   │ (from subscription)    │                       │
     │                   │                        │                       │
     │                   │ Update order → CONFIRMED                       │
     │                   │                        │                       │
     │ GET /api/orders/ORD-123 (next poll)        │                       │
     │──────────────────▶│                        │                       │
     │                   │                        │                       │
     │  ✅ {status:      │                        │                       │
     │     confirmed}    │                        │                       │
     │◀──────────────────│                        │                       │
     │                   │                        │                       │
     │ STOP POLLING      │                        │                       │
     │ Show success UI ✅│                        │                       │
```

#### Frontend Polling Strategy

```typescript
// Frontend: Poll until order status is final
async function waitForOrderConfirmation(orderId: string): Promise<Order> {
  const maxAttempts = 30;  // 60 seconds max wait
  const pollInterval = 2000; // 2 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const order = await fetch(`/api/orders/${orderId}`).then(r => r.json());
    
    // Final states - stop polling
    if (order.status === 'confirmed' || order.status === 'failed') {
      return order;
    }
    
    // Still pending - wait and retry
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  throw new Error('Order verification timed out');
}

// Usage after receiving 202 response
const response = await createOrder(orderData);

if (response.status === 'pending_verification') {
  showLoadingUI('Verifying your order...');
  const finalOrder = await waitForOrderConfirmation(response.orderId);
  
  if (finalOrder.status === 'confirmed') {
    showSuccessUI('Order confirmed!');
  } else {
    showErrorUI('Order failed: ' + finalOrder.failureReason);
  }
} else if (response.status === 'confirmed') {
  showSuccessUI('Order confirmed!');
}
```

#### Alternative: WebSocket for Real-Time Updates

```typescript
// Frontend can also connect to Order Service WebSocket for instant updates
const ws = new WebSocket('ws://order-service:3000/ws/orders');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  
  if (update.orderId === myOrderId) {
    if (update.status === 'confirmed') {
      showSuccessUI('Order confirmed!');
      ws.close();
    } else if (update.status === 'failed') {
      showErrorUI(update.reason);
      ws.close();
    }
  }
};

// Order Service broadcasts order status changes via WebSocket
// (internally subscribed to ASB order-events topic)
```
```

---

### Workflow 3: Schrödinger's Warehouse - Crash After Commit

```
┌─────────┐      ┌───────────────┐      ┌───────────────────┐      ┌─────────────┐
│ Frontend│      │ Order Service │      │ Inventory Service │      │     ASB     │
└────┬────┘      └───────┬───────┘      └─────────┬─────────┘      └──────┬──────┘
     │                   │                        │                       │
     │ POST /api/orders  │                        │                       │
     │──────────────────▶│                        │                       │
     │                   │                        │                       │
     │                   │  gRPC: ReserveStock    │                       │
     │                   │───────────────────────▶│                       │
     │                   │                        │                       │
     │                   │                        │ 1. Validate stock     │
     │                   │                        │ 2. BEGIN TRANSACTION  │
     │                   │                        │ 3. Deduct stock       │
     │                   │                        │ 4. COMMIT ✅          │
     │                   │                        │                       │
     │                   │                        │ 💥 CRASH! (before     │
     │                   │                        │    response sent)     │
     │                   │                        │                       │
     │                   │  ⚠️ Connection Error   │                       │
     │                   │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                       │
     │                   │                        │                       │
     │                   │ PUBLISH: VerifyOrder   │                       │
     │                   │───────────────────────────────────────────────▶│
     │                   │                        │                       │
     │  Response: 202    │                        │                       │
     │  {status:pending_ │                        │        📥 Message     │
     │   verification}   │                        │        queued         │
     │◀──────────────────│                        │                       │
     │                   │                        │                       │
     │                   │                        │ 🔄 SERVICE RESTARTS   │
     │                   │                        │                       │
     │                   │                        │◀──────────────────────│
     │                   │                        │ CONSUME: VerifyOrder  │
     │                   │                        │                       │
     │                   │                        │ Check DB: reservation │
     │                   │                        │ for ORD-123 exists?   │
     │                   │                        │                       │
     │                   │                        │ ✅ YES! Already       │
     │                   │                        │ committed before crash│
     │                   │                        │                       │
     │                   │                        │ PUBLISH: OrderVerified│
     │                   │                        │ {                     │
     │                   │                        │   orderId: "ORD-123", │
     │                   │                        │   status: "confirmed",│
     │                   │                        │   recoveredFromCrash: │
     │                   │                        │     true              │
     │                   │                        │ }                     │
     │                   │                        │──────────────────────▶│
     │                   │                        │                       │
     │                   │◀──────────────────────────────────────────────│
     │                   │ CONSUME: OrderVerified │                       │
     │                   │                        │                       │
     │                   │ Update: PENDING →      │                       │
     │                   │         CONFIRMED      │                       │
```

---

### Workflow 4: Dashboard Real-Time Updates

```
┌───────────────────┐      ┌───────────────────┐      ┌─────────────────┐      ┌──────────────┐
│ Inventory Service │      │        ASB        │      │Dashboard Backend│      │Dashboard (UI)│
└─────────┬─────────┘      └─────────┬─────────┘      └────────┬────────┘      └──────┬───────┘
          │                          │                         │                      │
          │ PUBLISH: StockReserved   │                         │                      │
          │─────────────────────────▶│                         │                      │
          │                          │                         │                      │
          │                          │ inventory-events topic  │                      │
          │                          │ → dashboard-sub         │                      │
          │                          │─────────────────────────▶                      │
          │                          │                         │                      │
          │                          │                         │ Transform event      │
          │                          │                         │ to WebSocket msg     │
          │                          │                         │                      │
          │                          │                         │ ws.send({            │
          │                          │                         │   type: "STOCK_     │
          │                          │                         │         UPDATE",    │
          │                          │                         │   data: {...}       │
          │                          │                         │ })                  │
          │                          │                         │─────────────────────▶│
          │                          │                         │                      │
          │                          │                         │                      │ Update UI:
          │                          │                         │                      │ • Stock chart
          │                          │                         │                      │ • Recent txns
          │                          │                         │                      │
          │ PUBLISH: ResponseTime    │                         │                      │
          │ (to system-metrics)      │                         │                      │
          │─────────────────────────▶│                         │                      │
          │                          │                         │                      │
          │                          │─────────────────────────▶                      │
          │                          │                         │                      │
          │                          │                         │ Calculate rolling    │
          │                          │                         │ 30s average          │
          │                          │                         │                      │
          │                          │                         │ IF avg > 1000ms:     │
          │                          │                         │   alert = RED 🔴     │
          │                          │                         │ ELSE:                │
          │                          │                         │   alert = GREEN 🟢   │
          │                          │                         │                      │
          │                          │                         │─────────────────────▶│
          │                          │                         │                      │ Update alert
          │                          │                         │                      │ indicator
```

---

### ASB Message Schemas

#### Topic: `inventory-events`

```typescript
// StockReserved
{
  eventType: "StockReserved",
  eventId: "evt-uuid-1234",
  timestamp: "2026-01-29T10:30:00Z",
  data: {
    orderId: "ORD-123",
    productId: "SKU-001",
    quantity: 2,
    remainingStock: 48,
    reservationId: "RES-456"
  }
}

// StockReleased (order cancelled)
{
  eventType: "StockReleased",
  eventId: "evt-uuid-5678",
  timestamp: "2026-01-29T10:35:00Z",
  data: {
    orderId: "ORD-123",
    productId: "SKU-001",
    quantity: 2,
    newStock: 50,
    reason: "order_cancelled"
  }
}

// LowStockAlert
{
  eventType: "LowStockAlert",
  eventId: "evt-uuid-9012",
  timestamp: "2026-01-29T10:40:00Z",
  data: {
    productId: "SKU-001",
    currentStock: 5,
    threshold: 10
  }
}
```

#### Topic: `order-events`

```typescript
// OrderCreated
{
  eventType: "OrderCreated",
  eventId: "evt-uuid-1111",
  timestamp: "2026-01-29T10:30:00Z",
  data: {
    orderId: "ORD-123",
    customerId: "CUST-789",
    items: [{ productId: "SKU-001", quantity: 2 }],
    status: "pending"
  }
}

// OrderConfirmed
{
  eventType: "OrderConfirmed",
  eventId: "evt-uuid-2222",
  timestamp: "2026-01-29T10:30:05Z",
  data: {
    orderId: "ORD-123",
    status: "confirmed",
    reservationId: "RES-456"
  }
}

// OrderFailed
{
  eventType: "OrderFailed",
  eventId: "evt-uuid-3333",
  timestamp: "2026-01-29T10:30:02Z",
  data: {
    orderId: "ORD-124",
    reason: "insufficient_stock",
    requestedQuantity: 100,
    availableStock: 50
  }
}
```

#### Topic: `system-metrics`

```typescript
// ResponseTime
{
  eventType: "ResponseTime",
  eventId: "evt-uuid-4444",
  timestamp: "2026-01-29T10:30:00Z",
  data: {
    service: "inventory-service",
    operation: "ReserveStock",
    durationMs: 245,
    success: true
  }
}

// ErrorOccurred
{
  eventType: "ErrorOccurred",
  eventId: "evt-uuid-5555",
  timestamp: "2026-01-29T10:30:00Z",
  data: {
    service: "inventory-service",
    operation: "ReserveStock",
    errorCode: "DB_CONNECTION_FAILED",
    errorMessage: "Connection pool exhausted"
  }
}

// HealthChanged
{
  eventType: "HealthChanged",
  eventId: "evt-uuid-6666",
  timestamp: "2026-01-29T10:30:00Z",
  data: {
    service: "inventory-service",
    previousStatus: "healthy",
    currentStatus: "unhealthy",
    failedDependency: "database"
  }
}
```

#### Queue: `verify-orders`

```typescript
// VerifyOrder (Schrödinger recovery)
{
  messageId: "msg-uuid-7777",
  timestamp: "2026-01-29T10:30:02Z",
  data: {
    orderId: "ORD-123",
    productId: "SKU-001",
    quantity: 2,
    originalRequestTime: "2026-01-29T10:30:00Z",
    reason: "grpc_timeout"  // or "connection_error"
  }
}
```

---

### ASB Configuration Summary

| Resource | Type | Publisher | Subscriber(s) | Purpose |
|----------|------|-----------|---------------|---------|
| `inventory-events` | Topic | Inventory Service | Order Service, Dashboard | Stock state changes |
| `order-events` | Topic | Order Service | Dashboard | Order lifecycle events |
| `system-metrics` | Topic | Both services | Dashboard | Performance monitoring |
| `verify-orders` | Queue | Order Service | Inventory Service | Schrödinger recovery |

---

## �📁 Project Structure

```
/
├── protos/
│   └── inventory.proto              # gRPC service definitions
│
├── order-service/
│   ├── Dockerfile
│   └── src/
│       ├── interface/               # REST API controllers
│       │   ├── routes.ts            # Order endpoints + /health
│       │   └── orderWs.ts           # WebSocket for real-time order updates
│       ├── domain/                  # Business logic
│       │   └── orderValidator.ts    # Order validation rules
│       ├── infrastructure/          # External communications
│       │   ├── grpcClient.ts        # Inventory gRPC client (2s timeout)
│       │   ├── serviceBusSender.ts  # Publish order-events
│       │   └── serviceBusConsumer.ts # Subscribe to inventory-events
│       ├── app.ts                   # Express application
│       └── telemetry.ts             # Application Insights setup
│
├── inventory-service/
│   ├── Dockerfile
│   └── src/
│       ├── handlers/                # gRPC implementations
│       │   └── inventoryHandler.ts  # ReserveStock, ReleaseStock, CheckStock
│       ├── interface/               # HTTP API (for frontend)
│       │   └── routes.ts            # GET /products, /health
│       ├── domain/                  # Stock management
│       │   └── stockRepository.ts   # PostgreSQL operations
│       ├── middleware/              # Chaos engineering
│       │   └── gremlin.ts           # Random latency simulator (2-5s)
│       ├── publishers/              # ASB event publishers
│       │   └── inventoryPublisher.ts # Publish StockReserved, StockReleased
│       ├── consumers/               # Async message handlers
│       │   └── verifyOrderConsumer.ts  # Schrödinger recovery
│       ├── server.ts                # gRPC + HTTP server entry point
│       └── telemetry.ts             # Application Insights setup
│
├── frontend/                        # Minimal UI
│   ├── Dockerfile
│   └── src/
│       └── App.tsx                  # Order placement & status view
│
├── dashboard/                       # Monitoring dashboard
│   ├── Dockerfile
│   └── src/
│       ├── App.tsx                  # Health status + response time alerts
│       ├── server/                  # Backend for browser
│       │   └── asbBridge.ts         # ASB → WebSocket bridge for browser
│       ├── services/
│       │   └── wsClient.ts          # WebSocket client (receives from bridge)
│       └── hooks/
│           └── useInventoryEvents.ts # Real-time inventory data via WebSocket
│
├── tests/
│   ├── load/                        # Load testing scripts
│   │   └── orderLoadTest.ts         # Automated verification pipeline
│   └── chaos/                       # Chaos simulation tests
│       └── schrodingerTest.ts       # Partial failure scenarios
│
├── docker-compose.yml               # All services orchestration
├── docker-compose.test.yml          # Test environment
├── .github/workflows/
│   └── ci.yml                       # CI/CD pipeline
├── tsconfig.base.json               # Shared TypeScript config
├── .env.example                     # Environment template
└── README.md
```

---

## ✅ Requirements Checklist

### 1. Microservices Architecture
- [ ] Break monolith into separate services
- [ ] Order Service: receives orders, validates, coordinates downstream
- [ ] Inventory Service: manages stock levels, updates on shipment
- [ ] **Database per Service**: Each service owns its data (no shared DB!)
- [ ] **Event-Driven Communication via Azure Service Bus (Primary)**
- [ ] Inventory Service PUBLISHES events (StockReserved, StockReleased, etc.)
- [ ] Order Service & Dashboard SUBSCRIBE to inventory-events topic
- [ ] gRPC used only for synchronous reserve request (with 2s timeout)

### 2. The Vanishing Response (Gremlin Latency)
- [ ] Inventory Service has configurable latency simulation
- [ ] `GREMLIN_MODE=true` enables 2-5 second random delays
- [ ] Order Service has 2-second timeout on Inventory calls
- [ ] Returns user-friendly timeout message instead of hanging

### 3. It Runs On My Machine (Automated Testing)
- [ ] `docker-compose up` starts entire system
- [ ] Automated test pipeline runs requests against Order Service
- [ ] Tests verify behavior under load with slow Inventory responses
- [ ] Affected orders recorded clearly without interrupting test flow
- [ ] Unaffected requests continue and complete normally

### 4. Go Beyond Your Logs (Health & Monitoring)
- [ ] `/health` endpoint on each service
- [ ] Health checks verify downstream dependencies (DB, ASB connection)
- [ ] Returns appropriate error if dependency is unhealthy
- [ ] **Dashboard subscribes to ASB topics** for real-time data
- [ ] Inventory Service publishes to `system-metrics` topic
- [ ] Monitoring dashboard with visual indicators
- [ ] **Alert**: Green → Red when avg response time > 1s over 30s window

### 5. Schrödinger's Warehouse (Partial Success Recovery)
- [ ] Handle crash after DB commit but before HTTP response
- [ ] Simulate unreliable behavior in Inventory Service
- [ ] Order Service publishes `VerifyOrder` to Azure Service Bus on timeout
- [ ] Inventory Service consumes messages and confirms idempotently
- [ ] Demonstrate increased end-user reliability under pressure

### 6. Just A Human Window (Frontend UI)
- [ ] Minimal user interface for order placement
- [ ] Display order status and inventory levels
- [ ] Show system behavior visually (success, timeout, recovery)

### 7. The First Cloud Frontier (Deployment)
- [ ] Deploy services to cloud provider (Azure/AWS/GCP)
- [ ] Services accessible outside local environment
- [ ] Small scale deployment demonstrating architecture

### 8. The Need to Leave a Trail Behind (Bonus: Backup)
- [ ] Data backup solution
- [ ] Work within constraint: backup service allows only 1 call/day
- [ ] Ensure data preserved multiple times

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Language** | TypeScript (Node.js 18+) |
| **Order Service** | Express.js (REST API) |
| **Inventory Service** | gRPC (@grpc/grpc-js) |
| **Databases** | PostgreSQL (1 per service) |
| **Message Queue** | Azure Service Bus |
| **Observability** | Azure Application Insights |
| **Containerization** | Docker & Docker Compose |
| **Frontend** | React (minimal) |
| **Testing** | Jest, Artillery (load tests) |

---

## ⚙️ Configuration

Create a `.env` file in the project root:

```env
# Order Service Database (owns: orders, order_items)
ORDER_DB_USER=order_admin
ORDER_DB_PASSWORD=order_secret
ORDER_DB_NAME=order_db
ORDER_DATABASE_URL=postgresql://order_admin:order_secret@order-db:5432/order_db

# Inventory Service Database (owns: products, stock, reservations)
INVENTORY_DB_USER=inventory_admin
INVENTORY_DB_PASSWORD=inventory_secret
INVENTORY_DB_NAME=inventory_db
INVENTORY_DATABASE_URL=postgresql://inventory_admin:inventory_secret@inventory-db:5432/inventory_db

# Azure Service Bus
SERVICE_BUS_CONNECTION_STRING="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=..."

# ASB Topics
ASB_TOPIC_INVENTORY_EVENTS=inventory-events
ASB_TOPIC_ORDER_EVENTS=order-events
ASB_TOPIC_SYSTEM_METRICS=system-metrics
ASB_QUEUE_VERIFY_ORDERS=verify-orders
ASB_SUBSCRIPTION_ORDER_SERVICE=order-service-sub
ASB_SUBSCRIPTION_DASHBOARD=dashboard-sub

# Azure Application Insights
APPLICATIONINSIGHTS_CONNECTION_STRING="InstrumentationKey=...;IngestionEndpoint=..."

# Service Configuration
ORDER_SERVICE_PORT=3000
INVENTORY_GRPC_PORT=50051
INVENTORY_HTTP_PORT=3001

# Chaos Engineering
GREMLIN_MODE=false
GREMLIN_MIN_DELAY_MS=2000
GREMLIN_MAX_DELAY_MS=5000

# Schrödinger Simulation (crash after commit)
SCHRODINGER_MODE=false
SCHRODINGER_CRASH_PROBABILITY=0.1
```

---

## 🚀 Quick Start

### Start All Services

```bash
# Clone repository
git clone https://github.com/Nadim1019/Valerixy.git
cd Valerixy

# Copy environment template
cp .env.example .env
# Edit .env with your Azure credentials

# Start all services
docker-compose up --build
```

### Service Endpoints

| Service | URL/Connection | Description |
|---------|----------------|-------------|
| Order Service (REST) | http://localhost:3000 | Create/view orders |
| Order Service (WebSocket) | ws://localhost:3000/ws/orders | Real-time order status updates |
| Order Health | http://localhost:3000/health | Health check |
| Inventory (gRPC) | localhost:50051 | Stock management |
| Inventory (REST) | http://localhost:3001 | Product listing for frontend |
| Inventory Health | http://localhost:3001/health | Health check |
| Frontend | http://localhost:8080 | User interface |
| Dashboard | http://localhost:8081 | Monitoring |
| Order DB | localhost:5432 | Order Service database |
| Inventory DB | localhost:5433 | Inventory Service database |
| **ASB: inventory-events** | Topic subscription | Stock updates (pub/sub) |
| **ASB: order-events** | Topic subscription | Order status (pub/sub) |
| **ASB: system-metrics** | Topic subscription | Response times, errors |

---

## 📡 API Reference

### Order Service REST API

```
POST /api/orders
  Body: { "productId": "string", "quantity": number }
  Response: { "orderId": "string", "status": "confirmed|timeout|pending_verification|failed" }

GET /api/orders/:id
  Response: { "orderId": "string", "status": "string", "items": [...] }

GET /api/orders
  Response: [ { "orderId": "string", ... }, ... ]

GET /health
  Response: { 
    "status": "healthy|unhealthy",
    "dependencies": {
      "database": "ok|error",
      "serviceBus": "ok|error",
      "inventoryGrpc": "ok|error"
    }
  }
```

### Inventory Service HTTP API (for Frontend)

```
GET /api/products
  Response: [ { "productId": "string", "name": "string", "stock": number }, ... ]

GET /api/products/:id
  Response: { "productId": "string", "name": "string", "stock": number }

GET /health
  Response: { 
    "status": "healthy|unhealthy",
    "dependencies": {
      "database": "ok|error",
      "serviceBus": "ok|error"
    }
  }
```

### Inventory Service gRPC (Internal)

```protobuf
syntax = "proto3";
package inventory;

service InventoryService {
  rpc ReserveStock(ReserveRequest) returns (ReserveResponse);
  rpc ReleaseStock(ReleaseRequest) returns (ReleaseResponse);
  rpc CheckStock(StockQuery) returns (StockResponse);
}

message ReserveRequest {
  string order_id = 1;
  string product_id = 2;
  int32 quantity = 3;
}

message ReserveResponse {
  bool success = 1;
  string message = 2;
  int32 remaining_stock = 3;
}
```

---

## 🧪 Testing

### Run Automated Test Pipeline

```bash
# Start test environment with chaos enabled
docker-compose -f docker-compose.test.yml up -d

# Run load tests
npm run test:load

# Run chaos tests (Schrödinger simulation)
npm run test:chaos

# View test results
cat test-results/report.json
```

### Manual Chaos Testing

```bash
# Restart inventory service with Gremlin latency enabled
GREMLIN_MODE=true docker-compose up -d inventory-service

# Restart with Schrödinger crashes enabled
SCHRODINGER_MODE=true SCHRODINGER_CRASH_PROBABILITY=0.3 docker-compose up -d inventory-service

# Or modify .env and restart
echo "GREMLIN_MODE=true" >> .env
docker-compose up -d inventory-service

# Send test orders
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"productId": "SKU-001", "quantity": 2}'
```

---

## 🔍 Monitoring & Alerts

### Dashboard Communication Methods

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AZURE SERVICE BUS                                    │
│                                                                         │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│   │ inventory-events│  │  order-events   │  │ system-metrics  │        │
│   │                 │  │                 │  │                 │        │
│   │ • StockReserved │  │ • OrderCreated  │  │ • ResponseTime  │        │
│   │ • StockReleased │  │ • OrderShipped  │  │ • ErrorOccurred │        │
│   │ • LowStockAlert │  │ • OrderFailed   │  │ • HealthChanged │        │
│   └────────┬────────┘  └────────┬────────┘  └────────┬────────┘        │
│            │                    │                    │                  │
└────────────┼────────────────────┼────────────────────┼──────────────────┘
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │ SUBSCRIBE
                                  ▼
                      ┌─────────────────────┐
                      │  Dashboard Backend  │
                      │  (Node.js Server)   │
                      │                     │
                      │  ASB Consumer →     │
                      │  WebSocket Server   │
                      │  (Bridge for browser│
                      └──────────┬──────────┘
                                 │ WebSocket
                                 ▼
                      ┌─────────────────────┐
                      │  Dashboard Frontend │
                      │      (React)        │
                      │                     │
                      │  Displays:          │
                      │  • Real-time stock  │
                      │  • Order status     │
                      │  • Response metrics │
                      │  • 🟢/🔴 Alerts    │
                      └──────────┬──────────┘
                                 │
                                 │ HTTP (Poll 5s)
                                 ▼
                      ┌─────────────────────┐
                      │  /health endpoints  │
                      │  (both services)    │
                      └─────────────────────┘
```

| Data Type | Protocol | Flow | Frequency |
|-----------|----------|------|----------|
| Stock Updates | **ASB → WebSocket** | ASB → Dashboard Backend → Browser | Push (real-time) |
| Order Status | **ASB → WebSocket** | ASB → Dashboard Backend → Browser | Push (real-time) |
| Response Metrics | **ASB → WebSocket** | ASB → Dashboard Backend → Browser | Push (on each request) |
| Error Events | **ASB → WebSocket** | ASB → Dashboard Backend → Browser | Push (on event) |
| Health Status | **HTTP REST** | Browser → Services `/health` | Poll every 5s |

### Why ASB → WebSocket Bridge?

- **Browser limitation**: `@azure/service-bus` SDK doesn't work in browsers
- **Security**: ASB connection strings stay on server, not exposed to client
- **Same event stream**: Dashboard backend subscribes like any other service
- **Scalable**: Multiple browser clients share one ASB subscription
- **Real-time**: WebSocket provides instant push to browser

### Health Check Logic

```typescript
// Order Service /health
{
  status: "healthy",
  timestamp: "2026-01-29T10:00:00Z",
  dependencies: {
    database: await checkPostgres(),      // Ping Order DB
    serviceBus: await checkASB(),         // ASB connection (primary)
    inventoryGrpc: await checkGrpc()      // gRPC fallback health
  }
}

// Inventory Service /health
{
  status: "healthy",
  timestamp: "2026-01-29T10:00:00Z",
  dependencies: {
    database: await checkPostgres(),      // Ping Inventory DB
    serviceBus: await checkASB()          // ASB publisher health
  }
}

// Returns "unhealthy" if ANY dependency fails
```

### Dashboard Alert Rules

| Metric | Threshold | Action |
|--------|-----------|--------|
| Avg Response Time | > 1s over 30s | 🟢 → 🔴 |
| Error Rate | > 5% | 🟢 → 🔴 |
| Health Check | Any unhealthy | 🟢 → 🔴 |

---

## 🛡️ Resilience Patterns

### Timeout & Fallback (Order → Inventory)

```typescript
// Order Service calls Inventory with 2s deadline
const response = await inventoryClient.reserveStock(request, {
  deadline: Date.now() + 2000  // 2 second timeout
});

// On timeout: publish to Service Bus queue for async recovery
if (error.code === grpc.status.DEADLINE_EXCEEDED) {
  await serviceBus.sendToQueue(
    process.env.ASB_QUEUE_VERIFY_ORDERS,  // 'verify-orders' queue
    { orderId, ...request }
  );
  return { status: 'pending_verification' };
}
```

### Idempotent Recovery (Schrödinger's Warehouse)

```typescript
// Inventory Service consumer
async function handleVerifyOrder(message: VerifyOrderMessage) {
  const existing = await db.findReservation(message.orderId);
  
  if (existing) {
    // Already processed - just acknowledge
    return { status: 'already_confirmed', reservation: existing };
  }
  
  // Process the reservation
  return await reserveStock(message);
}
```

---

## ☁️ Cloud Deployment

### Azure Container Instances (Minimal)

```bash
# Build and push images
docker-compose build
az acr login --name valerixregistry
docker-compose push

# Deploy
az container create --resource-group valerix-rg \
  --name valerix-services \
  --image valerixregistry.azurecr.io/order-service:latest \
  --ports 3000 50051
```

---

## 📜 License

MIT
