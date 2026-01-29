import { ServiceBusClient, ServiceBusReceiver, ProcessErrorArgs, ServiceBusReceivedMessage } from '@azure/service-bus';
import * as orderRepository from '../domain/orderRepository';
import { publishOrderEvent, generateEventId } from './orderPublisher';
import { trackEvent, trackException } from '../telemetry';
import { broadcastOrderUpdate } from '../interface/websocket';

const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING || '';

let serviceBusClient: ServiceBusClient | null = null;
let inventoryEventsReceiver: ServiceBusReceiver | null = null;

export async function startInventoryEventsConsumer(): Promise<void> {
  if (!connectionString) {
    console.log('[ASB] No connection string, consumer disabled');
    return;
  }
  
  try {
    serviceBusClient = new ServiceBusClient(connectionString);
    inventoryEventsReceiver = serviceBusClient.createReceiver(
      'inventory-events',
      'order-service-sub'
    );
    
    inventoryEventsReceiver.subscribe({
      processMessage: async (message: ServiceBusReceivedMessage) => {
        const event = message.body;
        console.log(`[ASB] Received inventory event: ${event.eventType}`);
        
        try {
          switch (event.eventType) {
            case 'StockReserved':
              await handleStockReserved(event);
              break;
            case 'StockReleased':
              await handleStockReleased(event);
              break;
            case 'OrderVerified':
            case 'VerificationComplete':
              await handleVerificationComplete(event);
              break;
            default:
              console.log(`[ASB] Unhandled event type: ${event.eventType}`);
          }
        } catch (error) {
          console.error(`[ASB] Error processing ${event.eventType}:`, error);
          trackException(error as Error, { eventType: event.eventType });
          throw error; // Retry
        }
      },
      processError: async (args: ProcessErrorArgs) => {
        console.error('[ASB] Error receiving message:', args.error);
        trackException(args.error, { source: 'InventoryEventsConsumer' });
      },
    });
    
    console.log('[ASB] Inventory events consumer started');
  } catch (error) {
    console.error('[ASB] Failed to start inventory events consumer:', error);
    trackException(error as Error, { component: 'InventoryEventsConsumer' });
  }
}

async function handleStockReserved(event: any): Promise<void> {
  const { orderId, reservationId } = event.data;
  
  console.log(`[ASB] Stock reserved for order ${orderId}, reservation ${reservationId}`);
  
  // Update order status to confirmed
  const order = await orderRepository.updateOrderStatus(
    orderId,
    'confirmed',
    reservationId
  );
  
  if (order) {
    // Publish order confirmed event
    await publishOrderEvent({
      eventType: 'OrderConfirmed',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        orderId,
        status: 'confirmed',
        reservationId,
      },
    });
    
    // Broadcast to WebSocket clients
    broadcastOrderUpdate({
      orderId,
      status: 'confirmed',
      reservationId,
    });
    
    trackEvent('OrderConfirmedViaASB', { orderId });
  }
}

async function handleStockReleased(event: any): Promise<void> {
  const { orderId, reason } = event.data;
  
  console.log(`[ASB] Stock released for order ${orderId}, reason: ${reason}`);
  
  trackEvent('StockReleasedReceived', { orderId, reason });
}

async function handleVerificationComplete(event: any): Promise<void> {
  const { orderId, reservationId, reason, status, recoveredFromCrash } = event.data;
  // Handle both formats: OrderVerified (status) and VerificationComplete (verified)
  const verified = event.data.verified ?? (status === 'confirmed');
  
  console.log(`[ASB] Verification complete for order ${orderId}: ${verified ? 'SUCCESS' : 'FAILED'} (recovered: ${recoveredFromCrash || false})`);
  
  const order = await orderRepository.getOrder(orderId);
  
  if (!order || order.status !== 'pending_verification') {
    console.log(`[ASB] Order ${orderId} not in pending_verification state, skipping`);
    return;
  }
  
  if (verified) {
    // Reservation was found - confirm the order
    await orderRepository.updateOrderStatus(orderId, 'confirmed', reservationId);
    
    await publishOrderEvent({
      eventType: 'OrderConfirmed',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        orderId,
        status: 'confirmed',
        reservationId,
        reason: 'Verified via Schrödinger recovery',
      },
    });
    
    broadcastOrderUpdate({
      orderId,
      status: 'confirmed',
      reservationId,
      message: 'Order confirmed after verification',
    });
  } else {
    // No reservation found - fail the order
    await orderRepository.updateOrderStatus(
      orderId,
      'failed',
      undefined,
      reason || 'Verification failed - no reservation found'
    );
    
    await publishOrderEvent({
      eventType: 'OrderFailed',
      eventId: generateEventId(),
      timestamp: new Date().toISOString(),
      data: {
        orderId,
        status: 'failed',
        reason: reason || 'Verification failed - no reservation found',
      },
    });
    
    broadcastOrderUpdate({
      orderId,
      status: 'failed',
      message: 'Order failed after verification',
    });
  }
  
  trackEvent('VerificationProcessed', { orderId, verified: String(verified) });
}

export async function stopInventoryEventsConsumer(): Promise<void> {
  if (inventoryEventsReceiver) {
    await inventoryEventsReceiver.close();
  }
  if (serviceBusClient) {
    await serviceBusClient.close();
  }
  console.log('[ASB] Inventory events consumer stopped');
}
