ALTER TABLE invoice_lines
  DROP CONSTRAINT invoice_lines_total_matches_components;

ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_total_matches_components CHECK (
    line_total =
      CASE WHEN kind = 'credit' THEN -1 ELSE 1 END
      * (
        round(quantity * unit_price, 2) - discount_amount
        + CASE WHEN tax_inclusive THEN 0 ELSE abs(tax_amount) END
      )
  );
