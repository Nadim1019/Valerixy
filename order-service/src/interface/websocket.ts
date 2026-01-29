import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { trackEvent } from '../telemetry';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    clients.add(ws);
    
    trackEvent('WebSocketConnected', { totalClients: String(clients.size) });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Order Service WebSocket',
      timestamp: new Date().toISOString(),
    }));
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('[WS] Received:', message);
        
        // Handle subscription requests
        if (message.type === 'subscribe' && message.orderId) {
          // Could implement per-order subscriptions here
          ws.send(JSON.stringify({
            type: 'subscribed',
            orderId: message.orderId,
          }));
        }
      } catch (error) {
        console.error('[WS] Failed to parse message:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      clients.delete(ws);
      trackEvent('WebSocketDisconnected', { totalClients: String(clients.size) });
    });
    
    ws.on('error', (error) => {
      console.error('[WS] Error:', error);
      clients.delete(ws);
    });
  });
  
  console.log('[WS] WebSocket server initialized');
}

export function broadcastOrderUpdate(data: any): void {
  const message = JSON.stringify({
    type: 'orderUpdate',
    ...data,
    timestamp: new Date().toISOString(),
  });
  
  let sentCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  });
  
  console.log(`[WS] Broadcasted order update to ${sentCount} clients`);
}

export function broadcastEvent(type: string, data: any): void {
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

export function getConnectedClientsCount(): number {
  return clients.size;
}
