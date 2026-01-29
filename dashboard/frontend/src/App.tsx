import { useState, useEffect, useRef, useCallback } from 'react';

interface ServiceStatus {
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastCheck: string;
}

interface Event {
  timestamp: string;
  service: string;
  eventType: string;
  data: any;
}

interface ResponseTime {
  timestamp: string;
  service: string;
  operation: string;
  durationMs: number;
}

interface ChaosStatus {
  gremlinEnabled: boolean;
  schrödingerEnabled: boolean;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState<Record<string, ServiceStatus>>({
    'order-service': { status: 'unknown', lastCheck: '' },
    'inventory-service': { status: 'unknown', lastCheck: '' },
  });
  const [events, setEvents] = useState<Event[]>([]);
  const [responseTimes, setResponseTimes] = useState<ResponseTime[]>([]);
  const [chaosStatus, setChaosStatus] = useState<ChaosStatus>({
    gremlinEnabled: false,
    schrödingerEnabled: false,
  });
  
  const wsRef = useRef<WebSocket | null>(null);

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'init':
          setServices(message.data.services || {});
          setEvents(message.data.events || []);
          setResponseTimes(message.data.responseTimes || []);
          break;
        case 'serviceHealth':
          setServices((prev) => ({
            ...prev,
            [message.data.service]: {
              status: message.data.healthy ? 'healthy' : 'unhealthy',
              lastCheck: message.timestamp,
            },
          }));
          break;
        case 'event':
          setEvents((prev) => [
            { timestamp: message.timestamp, ...message.data },
            ...prev.slice(0, 49),
          ]);
          break;
        case 'responseTime':
          setResponseTimes((prev) => [
            { timestamp: message.timestamp, ...message.data },
            ...prev.slice(0, 99),
          ]);
          break;
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connectWebSocket();
    fetchChaosStatus();
    fetchServicesHealth();
    
    // Poll services health every 10 seconds
    const interval = setInterval(fetchServicesHealth, 10000);
    
    return () => {
      clearInterval(interval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const fetchServicesHealth = async () => {
    try {
      const response = await fetch('/api/services/health');
      const data = await response.json();
      
      if (data.success) {
        const newServices: Record<string, ServiceStatus> = {};
        for (const [name, status] of Object.entries(data.data)) {
          const s = status as any;
          newServices[name] = {
            status: s.status === 'healthy' ? 'healthy' : 'unhealthy',
            lastCheck: data.timestamp,
          };
        }
        setServices(newServices);
      }
    } catch (error) {
      console.error('Failed to fetch services health:', error);
    }
  };

  const fetchChaosStatus = async () => {
    try {
      const response = await fetch('/api/chaos/status');
      const data = await response.json();
      
      if (data.success) {
        setChaosStatus({
          gremlinEnabled: data.data.gremlinEnabled,
          schrödingerEnabled: data.data.schrödingerEnabled,
        });
      }
    } catch (error) {
      console.error('Failed to fetch chaos status:', error);
    }
  };

  const toggleGremlin = async () => {
    try {
      const response = await fetch('/api/chaos/gremlin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !chaosStatus.gremlinEnabled }),
      });
      
      if (response.ok) {
        setChaosStatus((prev) => ({
          ...prev,
          gremlinEnabled: !prev.gremlinEnabled,
        }));
      }
    } catch (error) {
      console.error('Failed to toggle Gremlin:', error);
    }
  };

  const toggleSchrödinger = async () => {
    try {
      const response = await fetch('/api/chaos/schrodinger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !chaosStatus.schrödingerEnabled }),
      });
      
      if (response.ok) {
        setChaosStatus((prev) => ({
          ...prev,
          schrödingerEnabled: !prev.schrödingerEnabled,
        }));
      }
    } catch (error) {
      console.error('Failed to toggle Schrödinger:', error);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getBarHeight = (durationMs: number) => {
    // Scale: 0-100ms = 10-30%, 100-500ms = 30-60%, 500-2000ms = 60-90%, >2000ms = 90-100%
    if (durationMs < 100) return Math.max(10, (durationMs / 100) * 30);
    if (durationMs < 500) return 30 + ((durationMs - 100) / 400) * 30;
    if (durationMs < 2000) return 60 + ((durationMs - 500) / 1500) * 30;
    return 90 + Math.min(10, ((durationMs - 2000) / 3000) * 10);
  };

  const getBarClass = (durationMs: number) => {
    if (durationMs >= 2000) return 'timeout';
    if (durationMs >= 500) return 'slow';
    return '';
  };

  return (
    <div className="dashboard">
      <header>
        <h1>🛒 Valerix Monitoring Dashboard</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      <div className="grid">
        {/* Services Health */}
        <div className="card">
          <h2>Services Health</h2>
          <div className="services">
            {Object.entries(services).map(([name, status]) => (
              <div key={name} className="service">
                <span className="service-name">{name}</span>
                <span className={`service-status ${status.status}`}>
                  {status.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Chaos Engineering */}
        <div className="card">
          <h2>Chaos Engineering</h2>
          <div className="chaos-controls">
            <div className="chaos-toggle">
              <div className="chaos-info">
                <span className="chaos-label">🔥 Gremlin Latency</span>
                <span className="chaos-description">
                  Adds 2-5s delay to gRPC calls
                </span>
              </div>
              <button
                className={`toggle-btn ${chaosStatus.gremlinEnabled ? 'disable' : 'enable'}`}
                onClick={toggleGremlin}
              >
                {chaosStatus.gremlinEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
            <div className="chaos-toggle">
              <div className="chaos-info">
                <span className="chaos-label">🐱 Schrödinger Crash</span>
                <span className="chaos-description">
                  30% chance of crash after DB commit
                </span>
              </div>
              <button
                className={`toggle-btn ${chaosStatus.schrödingerEnabled ? 'disable' : 'enable'}`}
                onClick={toggleSchrödinger}
              >
                {chaosStatus.schrödingerEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
        </div>

        {/* Response Times */}
        <div className="card">
          <h2>Response Times (Last 30)</h2>
          <div className="metrics-chart">
            {responseTimes.slice(0, 30).reverse().map((rt, i) => (
              <div
                key={i}
                className={`metric-bar ${getBarClass(rt.durationMs)}`}
                style={{ height: `${getBarHeight(rt.durationMs)}%` }}
                title={`${rt.operation}: ${rt.durationMs}ms`}
              />
            ))}
          </div>
          <div className="metric-legend">
            <div className="legend-item">
              <div className="legend-color normal" />
              <span>&lt;500ms</span>
            </div>
            <div className="legend-item">
              <div className="legend-color slow" />
              <span>500-2000ms</span>
            </div>
            <div className="legend-item">
              <div className="legend-color timeout" />
              <span>&gt;2000ms (timeout)</span>
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div className="card">
          <h2>Recent Events</h2>
          <div className="events-list">
            {events.length === 0 ? (
              <p style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>
                No events yet
              </p>
            ) : (
              events.map((event, i) => (
                <div key={i} className={`event ${event.service}`}>
                  <div className="event-header">
                    <span className="event-type">{event.eventType}</span>
                    <span className="event-time">{formatTime(event.timestamp)}</span>
                  </div>
                  <div className="event-service">{event.service}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
