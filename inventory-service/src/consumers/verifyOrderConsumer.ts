import { ServiceBusClient, ServiceBusReceiver, ProcessErrorArgs } from '@azure/service-bus';
import { v4 as uuidv4 } from 'uuid';
import * as stockRepository from '../domain/stockRepository';
import { publishInventoryEvent, generateEventId } from '../publishers/inventoryPublisher';
import { trackException, trackEvent } from '../telemetry';

let serviceBusClient: ServiceBusClient | null = null;
let verifyOrderReceiver: ServiceBusReceiver | null = null;

interface VerifyOrderMessage {
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

export async function startVerifyOrderConsumer(): Promise<void> {
  const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  
  if (!connectionString || connectionString.includes('your-namespace') || connectionString === '') {
    console.log('[ASB Consumer] No valid connection string, running in offline mode');
    return;
  }
  
  try {
    serviceBusClient = new ServiceBusClient(connectionString);
    
    const queueName = 'verify-orders';
    verifyOrderReceiver = serviceBusClient.createReceiver(queueName);
    
    // Subscribe to messages
    verifyOrderReceiver.subscribe({
      processMessage: handleVerifyOrderMessage,
      processError: handleError,
    });
    
    console.log(`[ASB Consumer] Listening on queue: ${queueName}`);
  } catch (error) {
    console.error('[ASB Consumer] Failed to initialize:', error);
    trackException(error as Error, { context: 'asb_consumer_init' });
  }
}

async function handleVerifyOrderMessage(message: any): Promise<void> {
  const body = message.body as VerifyOrderMessage;
  const { orderId, productId, quantity, idempotencyKey } = body.data;
  
  console.log(`[ASB Consumer] Received VerifyOrder for order: ${orderId}`);
  trackEvent('VerifyOrderReceived', { orderId });
  
  try {
    // Check if reservation already exists (idempotent check)
    const existing = await stockRepository.findReservationByOrderId(orderId);
    
    if (existing) {
      // Reservation exists - order was successfully processed before crash
      console.log(`[ASB Consumer] Order ${orderId} already has reservation ${existing.id}`);
      
      await publishInventoryEvent({
        eventType: 'OrderVerified',
        eventId: generateEventId(),
        timestamp: new Date().toISOString(),
        data: {
          orderId,
          productId,
          quantity,
          status: 'confirmed',
          recoveredFromCrash: true,
          reservationId: existing.id,
        },
      });
      
      trackEvent('OrderVerifiedFromCrash', {
        orderId,
        reservationId: existing.id,
      });
    } else {
      // No reservation - try to create one
      console.log(`[ASB Consumer] No reservation found for order ${orderId}, creating...`);
      
      const result = await stockRepository.reserveStock(
        orderId,
        productId,
        quantity,
        `verify-${idempotencyKey}` // Use idempotency key
      );
      
      if (result.success) {
        await publishInventoryEvent({
          eventType: 'OrderVerified',
          eventId: generateEventId(),
          timestamp: new Date().toISOString(),
          data: {
            orderId,
            productId,
            quantity,
            status: 'confirmed',
            recoveredFromCrash: false,
            reservationId: result.reservationId,
          },
        });
        
        // Also publish the stock reserved event
        await publishInventoryEvent({
          eventType: 'StockReserved',
          eventId: generateEventId(),
          timestamp: new Date().toISOString(),
          data: {
            orderId,
            productId,
            quantity,
            remainingStock: result.remainingStock!,
            reservationId: result.reservationId!,
          },
        });
      } else {
        await publishInventoryEvent({
          eventType: 'OrderVerified',
          eventId: generateEventId(),
          timestamp: new Date().toISOString(),
          data: {
            orderId,
            productId,
            quantity,
            status: 'not_found',
            recoveredFromCrash: false,
          },
        });
        
        trackEvent('OrderVerificationFailed', {
          orderId,
          reason: result.message,
        });
      }
    }
  } catch (error) {
    console.error(`[ASB Consumer] Error processing VerifyOrder for ${orderId}:`, error);
    trackException(error as Error, {
      context: 'verify_order_processing',
      orderId,
    });
    throw error; // Will trigger retry
  }
}

async function handleError(args: ProcessErrorArgs): Promise<void> {
  console.error('[ASB Consumer] Error:', args.error);
  trackException(args.error, {
    context: 'asb_consumer_error',
    errorSource: args.errorSource,
  });
}

export async function closeConsumer(): Promise<void> {
  try {
    if (verifyOrderReceiver) await verifyOrderReceiver.close();
    if (serviceBusClient) await serviceBusClient.close();
    console.log('[ASB Consumer] Closed');
  } catch (error) {
    console.error('[ASB Consumer] Error closing:', error);
  }
}
