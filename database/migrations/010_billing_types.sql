ALTER TYPE invoice_status ADD VALUE 'confirmed';
ALTER TYPE invoice_status ADD VALUE 'cancelled';

CREATE TYPE invoice_kind AS ENUM ('billing', 'proration');
CREATE TYPE invoice_line_type AS ENUM ('charge', 'credit');
