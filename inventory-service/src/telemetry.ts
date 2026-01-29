import * as appInsights from 'applicationinsights';

export function initTelemetry(): void {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  
  if (connectionString) {
    appInsights.setup(connectionString)
      .setAutoDependencyCorrelation(true)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true)
      .setUseDiskRetryCaching(true)
      .setSendLiveMetrics(true)
      .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C);
    
    appInsights.start();
    console.log('[Telemetry] Application Insights initialized for Inventory Service');
  } else {
    console.log('[Telemetry] Application Insights connection string not found, skipping setup');
  }
}

// Alias for backward compatibility
export const setupTelemetry = initTelemetry;

export function trackEvent(name: string, properties?: Record<string, string>): void {
  if (appInsights.defaultClient) {
    appInsights.defaultClient.trackEvent({ name, properties });
  }
}

export function trackException(error: Error, properties?: Record<string, string>): void {
  if (appInsights.defaultClient) {
    appInsights.defaultClient.trackException({ exception: error, properties });
  }
  console.error('[Exception]', error.message, properties);
}

export function trackMetric(name: string, value: number): void {
  if (appInsights.defaultClient) {
    appInsights.defaultClient.trackMetric({ name, value });
  }
}

export const telemetryClient = appInsights.defaultClient;
