CREATE TABLE IF NOT EXISTS app_documents (
  collection_name VARCHAR(64) NOT NULL,
  document_id VARCHAR(64) NOT NULL,
  document_data JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  doc_openid VARCHAR(128) GENERATED ALWAYS AS
    (LEFT(JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.openid')), 128)) VIRTUAL,
  record_date VARCHAR(10) GENERATED ALWAYS AS
    (LEFT(JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.date')), 10)) VIRTUAL,
  PRIMARY KEY (collection_name, document_id),
  KEY idx_collection_updated (collection_name, updated_at),
  KEY idx_document_owner (collection_name, doc_openid, record_date),
  KEY idx_run_date (collection_name, record_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_mappings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  old_file_id TEXT NOT NULL,
  old_file_hash CHAR(64) NOT NULL,
  new_url TEXT NOT NULL,
  local_path TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_old_file_hash (old_file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migration_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  migration_type VARCHAR(32) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  imported_count INT UNSIGNED NOT NULL DEFAULT 0,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
