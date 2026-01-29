-- Inventory Service Database Schema
-- Products and Stock Management

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    low_stock_threshold INT NOT NULL DEFAULT 10,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reservations table (for tracking stock reservations)
CREATE TABLE IF NOT EXISTS reservations (
    id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, released, committed
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_reservations_order_id ON reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_product_id ON reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_reservations_idempotency_key ON reservations(idempotency_key);

-- Audit log for stock changes
CREATE TABLE IF NOT EXISTS stock_audit_log (
    id SERIAL PRIMARY KEY,
    product_id VARCHAR(50) NOT NULL REFERENCES products(id),
    operation VARCHAR(20) NOT NULL, -- reserve, release, adjust
    quantity_change INT NOT NULL,
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL,
    order_id VARCHAR(50),
    reservation_id VARCHAR(50),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample products
INSERT INTO products (id, name, description, price, stock, low_stock_threshold) VALUES
    ('SKU-001', 'Gaming Console X', 'Next-gen gaming console with 4K support', 499.99, 50, 10),
    ('SKU-002', 'Wireless Controller', 'Ergonomic wireless gaming controller', 69.99, 200, 20),
    ('SKU-003', 'Gaming Headset Pro', 'Surround sound gaming headset', 149.99, 100, 15),
    ('SKU-004', 'Gaming Monitor 27"', '144Hz 1ms response gaming monitor', 399.99, 30, 5),
    ('SKU-005', 'Mechanical Keyboard', 'RGB mechanical gaming keyboard', 129.99, 75, 10)
ON CONFLICT (id) DO NOTHING;

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reservations_updated_at ON reservations;
CREATE TRIGGER update_reservations_updated_at
    BEFORE UPDATE ON reservations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
