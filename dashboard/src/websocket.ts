import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

// Metrics storage (in-memory for simplicity)
interface ServiceMetrics {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastCheck: string;
  responseTime?: number;
  requestCount?: number;
}

interface MetricsStore {
  services: Record<string, ServiceMetrics>;
  events: Array<{
    timestamp: string;
    service: string;
    eventType: string;
    data: any;
  }>;
  responseTimes: Array<{
    timestamp: string;
    service: string;
    operation: string;
    durationMs: number;
  }>;
}

const metricsStore: MetricsStore = {
  services: {
    'order-service': { status: 'unknown', lastCheck: '' },
    'inventory-service': { status: 'unknown', lastCheck: '' },
  },
  events: [],
  responseTimes: [],
};

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('[WS] Dashboard client connected');
    clients.add(ws);
    
    // Send current state
    ws.send(JSON.stringify({
      type: 'init',
      data: metricsStore,
      timestamp: new Date().toISOString(),
    }));
    
    ws.on('close', () => {
      console.log('[WS] Dashboard client disconnected');
      clients.delete(ws);
    });
    
    ws.on('error', (error) => {
      console.error('[WS] Error:', error);
      clients.delete(ws);
    });
  });
  
  console.log('[WS] WebSocket server initialized');
}

export function broadcastMetric(type: string, data: any): void {
  // Store metrics
  if (type === 'serviceHealth') {
    const { service, healthy } = data;
    metricsStore.services[service] = {
      status: healthy ? 'healthy' : 'unhealthy',
      lastCheck: new Date().toISOString(),
      ...data,
    };
  } else if (type === 'responseTime') {
    metricsStore.responseTimes.push({
      timestamp: new Date().toISOString(),
      ...data,
    });
    // Keep only last 100 entries
    if (metricsStore.responseTimes.length > 100) {
      metricsStore.responseTimes = metricsStore.responseTimes.slice(-100);
    }
  } else if (type === 'event') {
    metricsStore.events.push({
      timestamp: new Date().toISOString(),
      ...data,
    });
    // Keep only last 50 events
    if (metricsStore.events.length > 50) {
      metricsStore.events = metricsStore.events.slice(-50);
    }
  }
  
  // Broadcast to all clients
  const message = JSON.stringify({
    type,
    data,
    timestamp: new Date().toISOString(),
  });
  
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function getMetricsStore(): MetricsStore {
  return metricsStore;
}

export function getConnectedClients(): number {
  return clients.size;
}
