import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { v4 as uuidv4 } from 'uuid';
import { trackEvent, trackException } from '../telemetry';

const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING || '';

let serviceBusClient: ServiceBusClient | null = null;
let orderEventsSender: ServiceBusSender | null = null;
let verifyOrdersSender: ServiceBusSender | null = null;

export async function initServiceBus(): Promise<void> {
  if (!connectionString) {
    console.log('[ASB] No connection string, Service Bus disabled');
    return;
  }
  
  try {
    serviceBusClient = new ServiceBusClient(connectionString);
    orderEventsSender = serviceBusClient.createSender('order-events');
    verifyOrdersSender = serviceBusClient.createSender('verify-orders');
    console.log('[ASB] Service Bus initialized');
  } catch (error) {
    console.error('[ASB] Failed to initialize Service Bus:', error);
    trackException(error as Error, { component: 'ServiceBusInit' });
  }
}

export interface OrderEvent {
  eventType: 'OrderCreated' | 'OrderConfirmed' | 'OrderFailed' | 'OrderCancelled' | 'OrderPendingVerification';
  eventId: string;
  timestamp: string;
  data: {
    orderId: string;
    customerId?: string;
    productId?: string;
    quantity?: number;
    status?: string;
    reason?: string;
    reservationId?: string;
  };
}

export interface VerifyOrderMessage {
  eventType: 'VerifyOrder';
  eventId: string;
  timestamp: string;
  data: {
    orderId: string;
    productId: string;
    quantity: number;
    idempotencyKey: string;
    originalRequestTime: string;
  };
}

export function generateEventId(): string {
  return uuidv4();
}

export async function publishOrderEvent(event: OrderEvent): Promise<void> {
  if (!orderEventsSender) {
    console.log('[ASB] Order events sender not available');
    return;
  }
  
  try {
    await orderEventsSender.sendMessages({
      body: event,
      contentType: 'application/json',
      subject: event.eventType,
      messageId: event.eventId,
      correlationId: event.data.orderId,
    });
    
    console.log(`[ASB] Published ${event.eventType} for order ${event.data.orderId}`);
    trackEvent('OrderEventPublished', { eventType: event.eventType, orderId: event.data.orderId });
  } catch (error) {
    console.error('[ASB] Failed to publish order event:', error);
    trackException(error as Error, { eventType: event.eventType, orderId: event.data.orderId });
    throw error;
  }
}

export async function sendVerifyOrderMessage(message: VerifyOrderMessage): Promise<void> {
  if (!verifyOrdersSender) {
    console.log('[ASB] Verify orders sender not available');
    return;
  }
  
  try {
    await verifyOrdersSender.sendMessages({
      body: message,
      contentType: 'application/json',
      subject: 'VerifyOrder',
      messageId: message.eventId,
      correlationId: message.data.orderId,
    });
    
    console.log(`[ASB] Sent VerifyOrder for order ${message.data.orderId}`);
    trackEvent('VerifyOrderSent', { orderId: message.data.orderId });
  } catch (error) {
    console.error('[ASB] Failed to send verify order message:', error);
    trackException(error as Error, { orderId: message.data.orderId });
    throw error;
  }
}

export async function closeServiceBus(): Promise<void> {
  if (serviceBusClient) {
    await serviceBusClient.close();
    console.log('[ASB] Service Bus connection closed');
  }
}
