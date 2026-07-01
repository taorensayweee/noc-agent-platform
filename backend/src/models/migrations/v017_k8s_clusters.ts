import { Migration } from './migrationFramework';
import { logger } from '../../utils/logger';

const v017K8sClusters: Migration = {
  id: '20240101000017',
  version: 17,
  name: 'k8s_clusters',
  description: 'Add Kubernetes cluster management table',

  up: async (db: any) => {
    logger.info('🔄 Creating k8s_clusters table...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS k8s_clusters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        api_url TEXT NOT NULL,
        token TEXT NOT NULL,
        ca_cert TEXT,
        skip_tls_verify INTEGER DEFAULT 0,
        description TEXT,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_k8s_clusters_name ON k8s_clusters(name);
      CREATE INDEX IF NOT EXISTS idx_k8s_clusters_enabled ON k8s_clusters(enabled);
    `);
    logger.info('✅ k8s_clusters table created');
  },

  down: async (db: any) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_k8s_clusters_enabled;
      DROP INDEX IF EXISTS idx_k8s_clusters_name;
      DROP TABLE IF EXISTS k8s_clusters;
    `);
  }
};

export default v017K8sClusters;
