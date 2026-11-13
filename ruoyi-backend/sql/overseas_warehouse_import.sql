-- 海外仓三种原始导出：以 system_sku 关联，关联时同时选择各来源批次。
-- 一行对应源文件一行；不对 SKU 或组合设置唯一约束，避免丢失一对多及重复记录。
-- SKU 必须按文本读取以保留前导零；空值保持 NULL，导入时保留原始日期及数量语义。
CREATE TABLE IF NOT EXISTS ow_import_batch (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id VARCHAR(36) NOT NULL COMMENT '三文件同批标识',
  source_type VARCHAR(32) NOT NULL COMMENT 'inventory/relation/stock_age',
  source_file VARCHAR(512) NOT NULL,
  source_sheet VARCHAR(255) DEFAULT NULL,
  imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remark TEXT,
  KEY idx_ow_batch_group (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='海外仓导入批次';

CREATE TABLE IF NOT EXISTS ow_product_inventory (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL,
  source_row INT NOT NULL,
  system_sku VARCHAR(255) DEFAULT NULL COMMENT 'SKU/系统SKU',
  barcode VARCHAR(255), fnsku VARCHAR(255), other_barcode VARCHAR(255),
  product_name VARCHAR(512), warehouse VARCHAR(255), stock_property VARCHAR(255),
  total_stock DECIMAL(20,4), available_inventory DECIMAL(20,4), locked_inventory DECIMAL(20,4),
  distribution_occupied_inventory DECIMAL(20,4), in_transit_inventory DECIMAL(20,4),
  oms_length DECIMAL(20,4), oms_width DECIMAL(20,4), oms_height DECIMAL(20,4), oms_weight DECIMAL(20,4),
  wms_length DECIMAL(20,4), wms_width DECIMAL(20,4), wms_height DECIMAL(20,4), wms_weight DECIMAL(20,4),
  length_unit VARCHAR(64), weight_unit VARCHAR(64), remark TEXT,
  KEY idx_inventory_sku (system_sku), KEY idx_inventory_batch (batch_id),
  CONSTRAINT fk_ow_inventory_batch FOREIGN KEY (batch_id) REFERENCES ow_import_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品库存原始行';

CREATE TABLE IF NOT EXISTS ow_platform_product_relation (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL, source_row INT NOT NULL,
  platform_store_code VARCHAR(255), platform_sku VARCHAR(255), system_sku VARCHAR(255),
  qty DECIMAL(20,4), system_sku_name VARCHAR(512), system_sku_status VARCHAR(255),
  source_create_time DATETIME DEFAULT NULL COMMENT '源表创建时间', remark TEXT,
  KEY idx_relation_sku (system_sku), KEY idx_relation_batch (batch_id),
  CONSTRAINT fk_ow_relation_batch FOREIGN KEY (batch_id) REFERENCES ow_import_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台产品映射原始行';

CREATE TABLE IF NOT EXISTS ow_product_stock_age (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT NOT NULL, source_row INT NOT NULL,
  system_sku VARCHAR(255) DEFAULT NULL COMMENT 'SKU/系统SKU',
  product_name VARCHAR(512), warehouse VARCHAR(255), stock_properties VARCHAR(255),
  stock_count_date DATE, putaway_date DATE, qty DECIMAL(20,4), stock_age DECIMAL(20,4),
  dimension VARCHAR(255) COMMENT '原始尺寸，含单位', total_volume VARCHAR(255) COMMENT '原始总体积，含单位', remark TEXT,
  KEY idx_stock_age_sku (system_sku), KEY idx_stock_age_batch (batch_id),
  CONSTRAINT fk_ow_stock_age_batch FOREIGN KEY (batch_id) REFERENCES ow_import_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品库龄原始行';
