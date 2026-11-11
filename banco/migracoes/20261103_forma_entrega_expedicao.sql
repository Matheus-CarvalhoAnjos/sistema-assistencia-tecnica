-- Add the delivery method to existing dispatch records without changing existing data.
ALTER TABLE expedicao
    ADD COLUMN forma_entrega VARCHAR(50) NULL AFTER data_envio;
