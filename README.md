# 📦 Valerix: Resilient E-Commerce Microservices

[![CI/CD Pipeline](https://github.com/Nadim1019/Valerixy/actions/workflows/ci.yml/badge.svg)](https://github.com/Nadim1019/Valerixy/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **High-Reliability Order & Inventory Management System**  
> Built with TypeScript, gRPC, PostgreSQL, and Azure Service Bus

---

## 🎯 Project Overview

Valerix transforms a monolithic e-commerce platform into a **resilient microservices architecture** capable of handling:

| Challenge | Solution |
|-----------|----------|
| **Network Latency** ("Gremlin Mode") | Configurable random delays with timeout handling |
| **Process Crashes** ("Schrödinger's Warehouse") | Async recovery via Azure Service Bus queues |
| **High Traffic Loads** | Event-driven architecture with parallel processing |
| **Partial Failures** | Graceful degradation without cascading errors |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AZURE SERVICE BUS (Event Backbone)                   │
│                                                                             │
│   Topics:                                                                   │
│   ├── inventory-events    (stock updates, reservations, releases)          │
│   ├── order-events        (order created, shipped, cancelled)              │
│   └── system-metrics      (response times, errors, health events)          │
└─────────┬──────────────────────┬──────────────────────┬─────────────────────┘
          │ PUBLISH              │ SUBSCRIBE            │ SUBSCRIBE
          ▼                      ▼                      ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Inventory Service  │  │    Order Service    │  │     Dashboard       │
│     (PUBLISHER)     │  │    (SUBSCRIBER)     │  │    (SUBSCRIBER)     │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│  ┌───────────────┐  │  │  ┌───────────────┐  │  │  Real-time display: │
│  │   /handlers   │  │  │  │  /interface   │  │  │  • Stock levels     │
│  │    (gRPC)     │  │  │  │    (REST)     │  │  │  • Order status     │
│  └───────┬───────┘  │  │  └───────┬───────┘  │  │  • Health alerts    │
│  ┌───────▼───────┐  │  │  ┌───────▼───────┐  │  │  • Response times   │
│  │    /domain    │  │  │  │    /domain    │  │  │                     │
│  │  (Stock Logic)│  │  │  │  (Validation) │  │  │  🟢/🔴 Visual      │
│  └───────┬───────┘  │  │  └───────┬───────┘  │  │     Alerts          │
│  ┌───────▼───────┐  │  │  ┌───────▼───────┐  │  │                     │
│  │  /publishers  │──┼──▶  │  /consumers   │  │  └─────────────────────┘
│  │ (ASB Sender)  │  │  │  │ (ASB Receiver)│  │
│  └───────────────┘  │  │  └───────────────┘  │
│  [Gremlin Mode]     │  │  [Timeout Handler]  │
└──────────┬──────────┘  └──────────┬──────────┘
           ▼                        ▼
   ┌───────────────┐        ┌───────────────┐
   │ Inventory DB  │        │   Order DB    │
   │ (PostgreSQL)  │        │ (PostgreSQL)  │
   └───────────────┘        └───────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMMUNICATION FLOW                                │
│                                                                             │
│   1. Order Service → Inventory (gRPC ReserveStock, 2s timeout)              │
│   2. Inventory → ASB (publishes StockReserved event)                        │
│   3. Order Service ← ASB (receives event via subscription)                  │
│   4. Dashboard ← ASB (real-time UI updates)                                 │
│   5. On gRPC timeout → Order publishes VerifyOrder for async recovery       │
│                                                                             │
│   ⚠️  Event-Driven: No direct service-to-service data queries!             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📬 Azure Service Bus - Workflow Guide

Azure Service Bus (ASB) is the **event backbone** of the Valerix architecture, enabling loose coupling, reliable messaging, and event-driven communication.

### Resource Structure

```
Azure Service Bus Namespace: valerix-ns
├── 📬 TOPICS (Pub/Sub)
│   ├── inventory-events
│   │   ├── order-service-sub      → Order Service
│   │   └── dashboard-sub          → Dashboard
│   ├── order-events  
│   │   └── dashboard-sub          → Dashboard
│   └── system-metrics
│       └── dashboard-sub          → Dashboard
└── 📥 QUEUES (Point-to-Point)
    └── verify-orders              → Inventory Service (Schrödinger recovery)
```

---

### Workflow 1: ✅ Happy Path - Successful Order

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

### Workflow 2: ⏳ Gremlin Mode - Timeout with Recovery

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

The frontend automatically polls for order status when receiving a `202 pending_verification` response, checking every 2 seconds until the order is confirmed or fails (max 60 seconds).

---

### Workflow 3: 💥 Schrödinger's Warehouse - Crash After Commit

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

### Workflow 4: 📊 Dashboard Real-Time Updates

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

<details>
<summary><strong>📦 inventory-events</strong> (click to expand)</summary>

```typescript
// StockReserved
{ eventType: "StockReserved", orderId: "ORD-123", productId: "SKU-001", quantity: 2, remainingStock: 48 }

// StockReleased
{ eventType: "StockReleased", orderId: "ORD-123", productId: "SKU-001", quantity: 2, reason: "order_cancelled" }

// LowStockAlert
{ eventType: "LowStockAlert", productId: "SKU-001", currentStock: 5, threshold: 10 }
```
</details>

<details>
<summary><strong>🛒 order-events</strong> (click to expand)</summary>

```typescript
// OrderCreated
{ eventType: "OrderCreated", orderId: "ORD-123", customerId: "CUST-789", status: "pending" }

// OrderConfirmed
{ eventType: "OrderConfirmed", orderId: "ORD-123", status: "confirmed", reservationId: "RES-456" }

// OrderFailed
{ eventType: "OrderFailed", orderId: "ORD-124", reason: "insufficient_stock" }
```
</details>

<details>
<summary><strong>📈 system-metrics</strong> (click to expand)</summary>

```typescript
// ResponseTime
{ eventType: "ResponseTime", service: "inventory-service", operation: "ReserveStock", durationMs: 245 }

// ErrorOccurred
{ eventType: "ErrorOccurred", service: "inventory-service", errorCode: "DB_CONNECTION_FAILED" }

// HealthChanged
{ eventType: "HealthChanged", service: "inventory-service", currentStatus: "unhealthy" }
```
</details>

<details>
<summary><strong>🔄 verify-orders Queue</strong> (click to expand)</summary>

```typescript
// VerifyOrder (Schrödinger recovery)
{ orderId: "ORD-123", productId: "SKU-001", quantity: 2, reason: "grpc_timeout" }
```
</details>

---

## 📁 Project Structure

```
Valerixy/
├── order-service/              # REST API for order management
│   └── src/
│       ├── interface/          # REST routes + WebSocket
│       ├── domain/             # Order repository & validation
│       ├── clients/            # gRPC client for Inventory
│       └── messaging/          # ASB publisher & consumer
│
├── inventory-service/          # gRPC service for stock management
│   └── src/
│       ├── handlers/           # gRPC implementations
│       ├── interface/          # HTTP routes for frontend
│       ├── domain/             # Stock repository
│       ├── middleware/         # Gremlin mode (chaos)
│       ├── publishers/         # ASB event publishers
│       └── consumers/          # Schrödinger recovery consumer
│
├── frontend/                   # React UI for order placement
├── dashboard/                  # Real-time monitoring dashboard
│   ├── frontend/               # React dashboard UI
│   └── src/                    # ASB → WebSocket bridge
│
├── protos/                     # gRPC protocol definitions
├── tests/                      # Load testing scripts
├── k8s/                        # Kubernetes manifests
├── .github/workflows/          # CI/CD pipelines
├── docker-compose.yml          # Local development setup
└── tsconfig.base.json          # Shared TypeScript config
```

---

## ✅ Requirements Checklist

### 1. Microservices Architecture
- [x] Break monolith into separate services
- [x] Order Service: receives orders, validates, coordinates downstream
- [x] Inventory Service: manages stock levels, handles reservations
- [x] **Database per Service**: Each service owns its data (no shared DB!)
- [x] **Event-Driven Communication via Azure Service Bus**
- [x] gRPC for synchronous reserve requests (with 2s timeout)

### 2. The Vanishing Response (Gremlin Latency)
- [x] Configurable latency simulation (`GREMLIN_MODE=true`)
- [x] Random 2-5 second delays when enabled
- [x] Order Service has 2-second timeout on Inventory calls
- [x] User-friendly timeout response instead of hanging

### 3. Automated Testing
- [x] `docker-compose up` starts entire system
- [x] Automated load test pipeline
- [x] Tests verify behavior under load with slow responses
- [x] Affected orders recorded without interrupting test flow

### 4. Health & Monitoring
- [x] `/health` endpoint on each service
- [x] Health checks verify dependencies (DB, ASB, gRPC)
- [x] Dashboard subscribes to ASB topics for real-time data
- [x] Visual alert: 🟢 → 🔴 when avg response time > 1s

### 5. Schrödinger's Warehouse (Partial Success Recovery)
- [x] Handle crash after DB commit but before HTTP response
- [x] Order Service publishes `VerifyOrder` to ASB queue on timeout
- [x] Inventory Service consumes and confirms idempotently

### 6. Frontend UI
- [x] Minimal interface for order placement
- [x] Display order status and inventory levels
- [x] Visual system behavior (success, timeout, recovery)

### 7. Cloud Deployment
- [x] CI/CD pipeline via GitHub Actions
- [x] Docker containerization for all services
- [x] Kubernetes manifests for production deployment

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
| **Orchestration** | Kubernetes |
| **Frontend** | React + Vite |
| **CI/CD** | GitHub Actions |

---

## ⚙️ Configuration

Create a `.env` file in the project root:

```env
# Database Configuration
ORDER_DATABASE_URL=postgresql://order_admin:order_secret@order-db:5432/order_db
INVENTORY_DATABASE_URL=postgresql://inventory_admin:inventory_secret@inventory-db:5432/inventory_db

# Azure Service Bus
SERVICE_BUS_CONNECTION_STRING="Endpoint=sb://your-namespace.servicebus.windows.net/;..."

# Service Ports
ORDER_SERVICE_PORT=3000
INVENTORY_GRPC_PORT=50051
INVENTORY_HTTP_PORT=3001

# Chaos Engineering (optional)
GREMLIN_MODE=false              # Enable random latency
GREMLIN_MIN_DELAY_MS=2000
GREMLIN_MAX_DELAY_MS=5000
SCHRODINGER_MODE=false          # Enable crash simulation
SCHRODINGER_CRASH_PROBABILITY=0.1
```

---

## 🚀 Quick Start

```bash
# Clone repository
git clone https://github.com/Nadim1019/Valerixy.git
cd Valerixy

# Copy environment template and configure
cp .env.example .env
# Edit .env with your Azure Service Bus credentials

# Start all services
docker-compose up --build

# Services will be available at:
# - Frontend:           http://localhost:8080
# - Dashboard:          http://localhost:8081
# - Order Service:      http://localhost:3000
# - Inventory Service:  http://localhost:3001
```

### Service Endpoints

| Service | Endpoint | Description |
|---------|----------|-------------|
| Frontend | `http://localhost:8080` | User interface |
| Dashboard | `http://localhost:8081` | Monitoring dashboard |
| Order API | `http://localhost:3000/api/orders` | REST API |
| Order Health | `http://localhost:3000/health` | Health check |
| Inventory API | `http://localhost:3001/api/products` | Product listing |
| Inventory Health | `http://localhost:3001/health` | Health check |
| Inventory gRPC | `localhost:50051` | Internal gRPC |

---

## 📡 API Reference

### Order Service

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/orders` | Create new order |
| `GET` | `/api/orders/:id` | Get order by ID |
| `GET` | `/api/orders` | List all orders |
| `GET` | `/health` | Health check |

**Create Order Request:**
```json
{ "productId": "SKU-001", "quantity": 2 }
```

**Response (success):**
```json
{ "orderId": "ORD-123", "status": "confirmed" }
```

**Response (timeout recovery):**
```json
{ "orderId": "ORD-123", "status": "pending_verification" }
```

### Inventory Service

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all products |
| `GET` | `/api/products/:id` | Get product by ID |
| `GET` | `/health` | Health check |

---

## 🧪 Testing

### Run Load Tests

```bash
# Start services
docker-compose up -d

# Run load test
./tests/load-test.sh

# Results saved to tests/results/
```

### Enable Chaos Testing

```bash
# Enable Gremlin mode (random 2-5s latency)
GREMLIN_MODE=true docker-compose up -d inventory-service

# Enable Schrödinger mode (random crashes after commit)
SCHRODINGER_MODE=true docker-compose up -d inventory-service

# Test with curl
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"productId": "SKU-001", "quantity": 2}'
```

---

## 🔍 Monitoring & Alerts

The dashboard receives real-time updates via Azure Service Bus → WebSocket bridge:

| Data Type | Protocol | Update Frequency |
|-----------|----------|------------------|
| Stock Updates | ASB → WebSocket | Real-time push |
| Order Status | ASB → WebSocket | Real-time push |
| Response Metrics | ASB → WebSocket | Per request |
| Health Status | HTTP REST | Poll every 5s |

### Alert Rules

| Metric | Threshold | Visual |
|--------|-----------|--------|
| Avg Response Time | > 1s over 30s | 🟢 → 🔴 |
| Error Rate | > 5% | 🟢 → 🔴 |
| Health Check | Any unhealthy | 🟢 → 🔴 |

---

## 🛡️ Resilience Patterns

### Timeout & Fallback

Order Service calls Inventory with a 2-second deadline. On timeout, it publishes to the `verify-orders` queue for async recovery:

```typescript
// On gRPC timeout
if (error.code === grpc.status.DEADLINE_EXCEEDED) {
  await serviceBus.sendToQueue('verify-orders', { orderId, productId, quantity });
  return { status: 'pending_verification' };
}
```

### Idempotent Recovery

Inventory Service handles duplicate verification requests safely:

```typescript
async function handleVerifyOrder(message) {
  const existing = await db.findReservation(message.orderId);
  if (existing) {
    return { status: 'already_confirmed' };  // Idempotent
  }
  return await reserveStock(message);
}
```

---

## 📜 License

MIT
