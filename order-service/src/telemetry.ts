import * as appInsights from 'applicationinsights';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  appInsights.setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setUseDiskRetryCaching(true)
    .start();
  
  console.log('[Telemetry] Application Insights initialized');
} else {
  console.log('[Telemetry] No connection string, telemetry disabled');
}

export const telemetryClient = connectionString ? appInsights.defaultClient : null;

export function initTelemetry(): void {
  // Called to ensure telemetry is initialized
}

export function trackEvent(name: string, properties?: Record<string, string>): void {
  if (telemetryClient) {
    telemetryClient.trackEvent({ name, properties });
  }
}

export function trackMetric(name: string, value: number): void {
  if (telemetryClient) {
    telemetryClient.trackMetric({ name, value });
  }
}

export function trackException(error: Error, properties?: Record<string, string>): void {
  if (telemetryClient) {
    telemetryClient.trackException({ exception: error, properties });
  }
  console.error('[Error]', error.message, properties);
}

export function trackDependency(
  name: string,
  dependencyTypeName: string,
  target: string,
  duration: number,
  success: boolean
): void {
  if (telemetryClient) {
    telemetryClient.trackDependency({
      name,
      dependencyTypeName,
      target,
      duration,
      resultCode: success ? 200 : 500,
      success,
      data: '',
    });
  }
}
