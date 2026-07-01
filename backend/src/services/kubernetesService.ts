import * as k8s from '@kubernetes/client-node';
import { randomUUID } from 'crypto';
import db from '../models/database';
import { decrypt, encrypt } from './encryptionService';
import { logger } from '../utils/logger';

interface ClusterRecord {
  id: string;
  name: string;
  api_url: string;
  token: string;
  ca_cert: string | null;
  skip_tls_verify: number;
  description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface K8sCluster {
  id: string;
  name: string;
  apiUrl: string;
  skipTlsVerify: boolean;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CachedClients {
  coreV1: k8s.CoreV1Api;
  appsV1: k8s.AppsV1Api;
  refreshAt: number;
}

export class KubernetesService {
  private clientCache = new Map<string, CachedClients>();

  private buildClients(cluster: ClusterRecord): CachedClients {
    const token = decrypt(cluster.token);
    const kc = new k8s.KubeConfig();

    const clusterEntry: k8s.Cluster = {
      name: cluster.name,
      server: cluster.api_url,
      skipTLSVerify: cluster.skip_tls_verify === 1,
      caData: cluster.ca_cert ? decrypt(cluster.ca_cert) : undefined,
    };

    kc.loadFromOptions({
      clusters: [clusterEntry],
      users: [{ name: 'noc-user', token }],
      contexts: [{ name: cluster.name, cluster: cluster.name, user: 'noc-user' }],
      currentContext: cluster.name,
    });

    return {
      coreV1: kc.makeApiClient(k8s.CoreV1Api),
      appsV1: kc.makeApiClient(k8s.AppsV1Api),
      refreshAt: Date.now() + 30 * 60 * 1000,
    };
  }

  private getClients(cluster: ClusterRecord): CachedClients {
    const cached = this.clientCache.get(cluster.id);
    if (cached && cached.refreshAt > Date.now()) return cached;
    const clients = this.buildClients(cluster);
    this.clientCache.set(cluster.id, clients);
    return clients;
  }

  private getClusterRecord(id: string): ClusterRecord | undefined {
    return db.prepare('SELECT * FROM k8s_clusters WHERE id = ? AND enabled = 1').get(id) as ClusterRecord | undefined;
  }

  // ── Cluster CRUD ─────────────────────────────────────────────────────────

  listClusters(): K8sCluster[] {
    const rows = db.prepare('SELECT * FROM k8s_clusters ORDER BY name').all() as ClusterRecord[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      apiUrl: r.api_url,
      skipTlsVerify: r.skip_tls_verify === 1,
      description: r.description ?? undefined,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  createCluster(data: {
    name: string;
    apiUrl: string;
    token: string;
    caBase64?: string;
    skipTlsVerify?: boolean;
    description?: string;
  }): K8sCluster {
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO k8s_clusters (id, name, api_url, token, ca_cert, skip_tls_verify, description, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id, data.name, data.apiUrl,
      encrypt(data.token),
      data.caBase64 ? encrypt(data.caBase64) : null,
      data.skipTlsVerify ? 1 : 0,
      data.description ?? null,
      now, now
    );

    logger.info(`K8s cluster created: ${data.name}`);
    return {
      id, name: data.name, apiUrl: data.apiUrl,
      skipTlsVerify: data.skipTlsVerify ?? false,
      description: data.description,
      enabled: true, createdAt: now, updatedAt: now,
    };
  }

  updateCluster(id: string, data: {
    name?: string;
    apiUrl?: string;
    token?: string;
    caBase64?: string;
    skipTlsVerify?: boolean;
    description?: string;
    enabled?: boolean;
  }): boolean {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
    if (data.apiUrl !== undefined) { sets.push('api_url = ?'); values.push(data.apiUrl); }
    if (data.token) { sets.push('token = ?'); values.push(encrypt(data.token)); }
    if (data.caBase64 !== undefined) { sets.push('ca_cert = ?'); values.push(data.caBase64 ? encrypt(data.caBase64) : null); }
    if (data.skipTlsVerify !== undefined) { sets.push('skip_tls_verify = ?'); values.push(data.skipTlsVerify ? 1 : 0); }
    if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description); }
    if (data.enabled !== undefined) { sets.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    values.push(now, id);

    const result = db.prepare(`UPDATE k8s_clusters SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    this.clientCache.delete(id);
    return result.changes > 0;
  }

  deleteCluster(id: string): boolean {
    const result = db.prepare('DELETE FROM k8s_clusters WHERE id = ?').run(id);
    this.clientCache.delete(id);
    return result.changes > 0;
  }

  // ── Connectivity ──────────────────────────────────────────────────────────

  async testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) return { ok: false, error: '集群不存在或已禁用' };
    try {
      const { coreV1 } = this.getClients(cluster);
      await coreV1.listNamespace();
      return { ok: true };
    } catch (e: any) {
      const msg = e?.body?.message || e?.message || '连接失败';
      return { ok: false, error: msg };
    }
  }

  // ── Namespaces ────────────────────────────────────────────────────────────

  async listNamespaces(id: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { coreV1 } = this.getClients(cluster);
    const { body } = await coreV1.listNamespace();
    return (body.items || []).map(ns => ({
      name: ns.metadata?.name ?? '',
      status: ns.status?.phase ?? 'Unknown',
      createdAt: ns.metadata?.creationTimestamp,
    }));
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────

  async listNodes(id: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { coreV1 } = this.getClients(cluster);
    const { body } = await coreV1.listNode();
    return (body.items || []).map(node => {
      const readyCond = (node.status?.conditions || []).find(c => c.type === 'Ready');
      const roles = Object.keys(node.metadata?.labels || {})
        .filter(k => k.startsWith('node-role.kubernetes.io/'))
        .map(k => k.replace('node-role.kubernetes.io/', ''));
      return {
        name: node.metadata?.name ?? '',
        status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
        roles: roles.length ? roles : ['<none>'],
        version: node.status?.nodeInfo?.kubeletVersion ?? '',
        os: node.status?.nodeInfo?.osImage ?? '',
        internalIP: node.status?.addresses?.find(a => a.type === 'InternalIP')?.address ?? '',
        cpu: node.status?.capacity?.['cpu'] ?? '',
        memory: node.status?.capacity?.['memory'] ?? '',
        createdAt: node.metadata?.creationTimestamp,
      };
    });
  }

  // ── Pods ──────────────────────────────────────────────────────────────────

  async listPods(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { coreV1 } = this.getClients(cluster);
    const { body } = namespace
      ? await coreV1.listNamespacedPod(namespace)
      : await coreV1.listPodForAllNamespaces();
    return (body.items || []).map(pod => {
      const containerStatuses = pod.status?.containerStatuses || [];
      return {
        name: pod.metadata?.name ?? '',
        namespace: pod.metadata?.namespace ?? '',
        status: pod.status?.phase ?? 'Unknown',
        ready: `${containerStatuses.filter(c => c.ready).length}/${containerStatuses.length}`,
        restarts: containerStatuses.reduce((s, c) => s + (c.restartCount || 0), 0),
        containers: (pod.spec?.containers || []).map(c => c.name),
        nodeName: pod.spec?.nodeName ?? '',
        podIP: pod.status?.podIP ?? '',
        createdAt: pod.metadata?.creationTimestamp,
      };
    });
  }

  // ── Deployments ───────────────────────────────────────────────────────────

  async listDeployments(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { appsV1 } = this.getClients(cluster);
    const { body } = namespace
      ? await appsV1.listNamespacedDeployment(namespace)
      : await appsV1.listDeploymentForAllNamespaces();
    return (body.items || []).map(dep => ({
      name: dep.metadata?.name ?? '',
      namespace: dep.metadata?.namespace ?? '',
      ready: `${dep.status?.readyReplicas ?? 0}/${dep.spec?.replicas ?? 0}`,
      available: dep.status?.availableReplicas ?? 0,
      images: (dep.spec?.template?.spec?.containers || []).map(c => c.image ?? ''),
      createdAt: dep.metadata?.creationTimestamp,
    }));
  }

  // ── Services ──────────────────────────────────────────────────────────────

  async listServices(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { coreV1 } = this.getClients(cluster);
    const { body } = namespace
      ? await coreV1.listNamespacedService(namespace)
      : await coreV1.listServiceForAllNamespaces();
    return (body.items || []).map(svc => ({
      name: svc.metadata?.name ?? '',
      namespace: svc.metadata?.namespace ?? '',
      type: svc.spec?.type ?? '',
      clusterIP: svc.spec?.clusterIP ?? '',
      externalIP: (svc.status?.loadBalancer?.ingress || [])
        .map(i => i.ip || i.hostname || '').filter(Boolean).join(', ') || '<none>',
      ports: (svc.spec?.ports || [])
        .map(p => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol || 'TCP'}`)
        .join(', '),
      createdAt: svc.metadata?.creationTimestamp,
    }));
  }

  // ── Pod Logs ──────────────────────────────────────────────────────────────

  async getPodLogs(id: string, namespace: string, podName: string, container?: string, tailLines = 200): Promise<string> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { coreV1 } = this.getClients(cluster);
    const { body } = await coreV1.readNamespacedPodLog(
      podName, namespace,
      container || undefined,
      false, undefined, undefined, undefined, false, undefined, tailLines, undefined
    );
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
}

export const kubernetesService = new KubernetesService();
