import { useState, useEffect, useRef, useCallback } from 'react';

interface Product {
  id: string;
  name: string;
  stock: number;
  lowStockThreshold: number;
}

interface Order {
  id: string;
  customerId: string;
  productId: string;
  quantity: number;
  status: string;
  createdAt: string;
  reservationId?: string;
  errorMessage?: string;
}

interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const ORDER_API = '/api';

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);

  const showNotification = useCallback((message: string, type: Notification['type']) => {
    const id = Date.now().toString();
    setNotification({ id, message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

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
      
      if (message.type === 'orderUpdate') {
        // Update order in the list
        setOrders((prev) =>
          prev.map((order) =>
            order.id === message.orderId
              ? { ...order, status: message.status, reservationId: message.reservationId }
              : order
          )
        );
        
        // Show notification
        if (message.status === 'confirmed') {
          showNotification(`Order ${message.orderId.slice(0, 8)}... confirmed!`, 'success');
        } else if (message.status === 'failed') {
          showNotification(`Order ${message.orderId.slice(0, 8)}... failed`, 'error');
        }
        
        // Refresh products to get updated stock
        fetchProducts();
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  }, [showNotification]);

  const fetchProducts = async () => {
    try {
      // Fetch from inventory service via order service proxy
      const response = await fetch(`${ORDER_API}/products`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.data || []);
        
        // Initialize quantities
        const initQty: Record<string, number> = {};
        (data.data || []).forEach((p: Product) => {
          if (!quantities[p.id]) {
            initQty[p.id] = 1;
          }
        });
        setQuantities((prev) => ({ ...prev, ...initQty }));
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await fetch(`${ORDER_API}/orders?limit=20`);
      if (response.ok) {
        const data = await response.json();
        setOrders(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchOrders();
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const handleQuantityChange = (productId: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(1, (prev[productId] || 1) + delta),
    }));
  };

  const handleOrder = async (product: Product) => {
    const quantity = quantities[product.id] || 1;
    
    if (quantity > product.stock) {
      showNotification('Not enough stock available', 'error');
      return;
    }
    
    setLoading((prev) => ({ ...prev, [product.id]: true }));
    
    try {
      const response = await fetch(`${ORDER_API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: 'demo-user',
          productId: product.id,
          quantity,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Add order to list
        setOrders((prev) => [data.data, ...prev]);
        
        // Reset quantity
        setQuantities((prev) => ({ ...prev, [product.id]: 1 }));
        
        // Show appropriate notification
        if (data.verificationRequired) {
          showNotification('Order submitted - verifying...', 'info');
        } else if (data.data.status === 'confirmed') {
          showNotification('Order confirmed!', 'success');
        }
        
        // Refresh products
        fetchProducts();
      } else {
        showNotification(data.error || 'Order failed', 'error');
        if (data.data) {
          setOrders((prev) => [data.data, ...prev]);
        }
      }
    } catch (error) {
      showNotification('Failed to place order', 'error');
    } finally {
      setLoading((prev) => ({ ...prev, [product.id]: false }));
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="app">
      <header>
        <h1>🛒 Valerix Store</h1>
        <p>Resilient E-Commerce Demo</p>
        <div className="connection-badge">
          <span className={`connection-dot ${connected ? '' : 'disconnected'}`} />
          <span>{connected ? 'Real-time updates' : 'Connecting...'}</span>
        </div>
      </header>

      <div className="main-grid">
        {/* Products */}
        <div className="card">
          <h2>📦 Products</h2>
          <div className="products-grid">
            {products.length === 0 ? (
              <div className="empty-state">Loading products...</div>
            ) : (
              products.map((product) => (
                <div key={product.id} className="product">
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    <span className={`product-stock ${product.stock <= product.lowStockThreshold ? 'low' : ''}`}>
                      {product.stock} in stock
                    </span>
                  </div>
                  <div className="quantity-control">
                    <button onClick={() => handleQuantityChange(product.id, -1)}>-</button>
                    <span>{quantities[product.id] || 1}</span>
                    <button onClick={() => handleQuantityChange(product.id, 1)}>+</button>
                    <button
                      className="order-btn"
                      onClick={() => handleOrder(product)}
                      disabled={loading[product.id] || product.stock === 0}
                    >
                      {loading[product.id] ? <span className="loading" /> : 'Order'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Orders */}
        <div className="card">
          <h2>📋 Recent Orders</h2>
          <div className="orders-list">
            {orders.length === 0 ? (
              <div className="empty-state">No orders yet</div>
            ) : (
              orders.map((order) => (
                <div key={order.id} className={`order ${order.status}`}>
                  <div className="order-header">
                    <span className="order-id">{order.id.slice(0, 8)}...</span>
                    <span className={`order-status ${order.status}`}>{order.status}</span>
                  </div>
                  <div className="order-details">
                    <span className="order-product">Product: {order.productId.slice(0, 8)}...</span>
                    <span className="order-quantity"> × {order.quantity}</span>
                  </div>
                  <div className="order-time">{formatTime(order.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}

export default App;
