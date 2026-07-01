import { MigrationManager, Migration } from './migrationFramework';
import v001InitialSchema from './v001_initial_schema';
import v002AddApiProvider from './v002_add_api_provider';
import v003AddAIModelsTable from './v003_add_ai_models';
import v004AddAgentModelFields from './v004_add_agent_model_fields';
import v005SSHKeyPasswordSupport from './v005_ssh_key_password_support';
import v006NetworkDeviceCredentials from './v006_network_device_credentials';
import v016DatabasesTable from './v016_databases_table';
import v017K8sClusters from './v017_k8s_clusters';

export const ALL_MIGRATIONS: Migration[] = [
  v001InitialSchema,
  v002AddApiProvider,
  v003AddAIModelsTable,
  v004AddAgentModelFields,
  v005SSHKeyPasswordSupport,
  v006NetworkDeviceCredentials,
  v016DatabasesTable,
  v017K8sClusters,
];

export function createMigrationManager(db: any): MigrationManager {
  const manager = new MigrationManager(db);
  manager.registerBatch(ALL_MIGRATIONS);
  return manager;
}

export { MigrationManager } from './migrationFramework';
export type { Migration, MigrationRecord, MigrationResult } from './migrationFramework';
