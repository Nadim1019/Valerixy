import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { trackException, trackEvent } from '../telemetry';

let serviceBusClient: ServiceBusClient | null = null;
let inventoryEventsSender: ServiceBusSender | null = null;
let systemMetricsSender: ServiceBusSender | null = null;

// Event types
export interface StockReservedEvent {
  eventType: 'StockReserved';
  eventId: string;
  timestamp: string;
  data: {
    orderId: string;
    productId: string;
    quantity: number;
    remainingStock: number;
    reservationId: string;
  };
}

export interface StockReleasedEvent {
  eventType: 'StockReleased';
  eventId: string;
  timestamp: string;
  data: {
    orderId: string;
    productId: string;
    quantity: number;
    newStock: number;
    reason: string;
  };
}

export interface LowStockAlertEvent {
  eventType: 'LowStockAlert';
  eventId: string;
  timestamp: string;
  data: {
    productId: string;
    currentStock: number;
    threshold: number;
  };
}

export interface ResponseTimeEvent {
  eventType: 'ResponseTime';
  eventId: string;
  timestamp: string;
  data: {
    service: string;
    operation: string;
    durationMs: number;
    success: boolean;
  };
}

export interface OrderVerifiedEvent {
  eventType: 'OrderVerified';
  eventId: string;
  timestamp: string;
  data: {
    orderId: string;
    productId: string;
    quantity: number;
    status: 'confirmed' | 'not_found';
    recoveredFromCrash: boolean;
    reservationId?: string;
  };
}

type InventoryEvent = StockReservedEvent | StockReleasedEvent | LowStockAlertEvent | OrderVerifiedEvent;
type MetricEvent = ResponseTimeEvent;

export async function initializePublisher(): Promise<void> {
  const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  
  if (!connectionString || connectionString.includes('your-namespace')) {
    console.log('[ASB Publisher] No valid connection string, running in offline mode');
    return;
  }
  
  try {
    serviceBusClient = new ServiceBusClient(connectionString);
    
    const inventoryTopic = process.env.ASB_TOPIC_INVENTORY_EVENTS || 'inventory-events';
    const metricsTopic = process.env.ASB_TOPIC_SYSTEM_METRICS || 'system-metrics';
    
    inventoryEventsSender = serviceBusClient.createSender(inventoryTopic);
    systemMetricsSender = serviceBusClient.createSender(metricsTopic);
    
    console.log(`[ASB Publisher] Initialized for topics: ${inventoryTopic}, ${metricsTopic}`);
  } catch (error) {
    console.error('[ASB Publisher] Failed to initialize:', error);
    trackException(error as Error, { context: 'asb_publisher_init' });
  }
}

export async function publishInventoryEvent(event: InventoryEvent): Promise<void> {
  if (!inventoryEventsSender) {
    console.log('[ASB Publisher] Offline mode - would publish:', event.eventType);
    return;
  }
  
  try {
    await inventoryEventsSender.sendMessages({
      body: event,
      contentType: 'application/json',
      messageId: event.eventId,
      subject: event.eventType,
    });
    
    const orderId = 'orderId' in event.data ? (event.data as any).orderId : 'N/A';
    console.log(`[ASB Publisher] Published ${event.eventType} for order ${orderId}`);
    trackEvent('ASBEventPublished', { eventType: event.eventType });
  } catch (error) {
    console.error('[ASB Publisher] Failed to publish event:', error);
    trackException(error as Error, { context: 'publish_inventory_event', eventType: event.eventType });
  }
}

export async function publishMetricEvent(event: MetricEvent): Promise<void> {
  if (!systemMetricsSender) {
    return; // Silent in offline mode for metrics
  }
  
  try {
    await systemMetricsSender.sendMessages({
      body: event,
      contentType: 'application/json',
      messageId: event.eventId,
      subject: event.eventType,
    });
  } catch (error) {
    // Don't spam logs for metric failures
    trackException(error as Error, { context: 'publish_metric_event' });
  }
}

export async function closePublisher(): Promise<void> {
  try {
    if (inventoryEventsSender) await inventoryEventsSender.close();
    if (systemMetricsSender) await systemMetricsSender.close();
    if (serviceBusClient) await serviceBusClient.close();
    console.log('[ASB Publisher] Closed');
  } catch (error) {
    console.error('[ASB Publisher] Error closing:', error);
  }
}

// Helper to generate event ID
export function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
