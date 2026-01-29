import { ServiceBusClient, ServiceBusReceiver, ProcessErrorArgs, ServiceBusReceivedMessage } from '@azure/service-bus';
import { broadcastMetric } from './websocket';

const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING || '';

let serviceBusClient: ServiceBusClient | null = null;
let metricsReceiver: ServiceBusReceiver | null = null;
let inventoryReceiver: ServiceBusReceiver | null = null;
let orderReceiver: ServiceBusReceiver | null = null;

export async function startMetricsConsumer(): Promise<void> {
  if (!connectionString) {
    console.log('[ASB] No connection string, metrics consumer disabled');
    return;
  }
  
  try {
    serviceBusClient = new ServiceBusClient(connectionString);
    
    // Subscribe to system-metrics topic
    metricsReceiver = serviceBusClient.createReceiver(
      'system-metrics',
      'dashboard-sub'
    );
    
    metricsReceiver.subscribe({
      processMessage: async (message: ServiceBusReceivedMessage) => {
        const event = message.body;
        console.log(`[ASB] Received metric: ${event.eventType}`);
        
        if (event.eventType === 'ResponseTime') {
          broadcastMetric('responseTime', event.data);
        } else if (event.eventType === 'HealthStatus') {
          broadcastMetric('serviceHealth', event.data);
        }
      },
      processError: async (args: ProcessErrorArgs) => {
        console.error('[ASB] Metrics error:', args.error);
      },
    });
    
    // Subscribe to inventory-events topic
    inventoryReceiver = serviceBusClient.createReceiver(
      'inventory-events',
      'dashboard-sub'
    );
    
    inventoryReceiver.subscribe({
      processMessage: async (message: ServiceBusReceivedMessage) => {
        const event = message.body;
        console.log(`[ASB] Received inventory event: ${event.eventType}`);
        
        broadcastMetric('event', {
          service: 'inventory-service',
          eventType: event.eventType,
          data: event.data,
        });
      },
      processError: async (args: ProcessErrorArgs) => {
        console.error('[ASB] Inventory events error:', args.error);
      },
    });
    
    // Subscribe to order-events topic
    orderReceiver = serviceBusClient.createReceiver(
      'order-events',
      'dashboard-sub'
    );
    
    orderReceiver.subscribe({
      processMessage: async (message: ServiceBusReceivedMessage) => {
        const event = message.body;
        console.log(`[ASB] Received order event: ${event.eventType}`);
        
        broadcastMetric('event', {
          service: 'order-service',
          eventType: event.eventType,
          data: event.data,
        });
      },
      processError: async (args: ProcessErrorArgs) => {
        console.error('[ASB] Order events error:', args.error);
      },
    });
    
    console.log('[ASB] All consumers started');
  } catch (error) {
    console.error('[ASB] Failed to start consumers:', error);
  }
}

export async function stopMetricsConsumer(): Promise<void> {
  if (metricsReceiver) await metricsReceiver.close();
  if (inventoryReceiver) await inventoryReceiver.close();
  if (orderReceiver) await orderReceiver.close();
  if (serviceBusClient) await serviceBusClient.close();
  console.log('[ASB] All consumers stopped');
}
