DROP TABLE IF EXISTS tracking_numbers;
CREATE TABLE IF NOT EXISTS tracking_numbers (
    tracking_number TEXT PRIMARY KEY,
    order_number TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert some sample data for testing
INSERT INTO tracking_numbers (tracking_number, order_number, status, created_at, updated_at) 
VALUES 
    ('9400111105501612009154', NULL, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('9400111105501612835722', NULL, 'in_transit', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('9400111105501612819753', NULL, 'delivered', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('9400111105501612849477', NULL, 'out_for_delivery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
