import * as k8s from '@kubernetes/client-node';
import { randomUUID } from 'crypto';
import { PassThrough } from 'stream';
import db from '../models/database';
import { decrypt, encrypt } from './encryptionService';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  kc: k8s.KubeConfig;
  coreV1: k8s.CoreV1Api;
  appsV1: k8s.AppsV1Api;
  networkingV1: k8s.NetworkingV1Api;
  customObjects: k8s.CustomObjectsApi;
  refreshAt: number;
}

interface ExecSession {
  sessionId: string;
  ws: any; // WebSocket returned by Exec.exec()
  stdin: PassThrough;
}

const ISTIO_GROUP = 'networking.istio.io';
const ISTIO_VERSION = 'v1beta1';

const ISTIO_PLURALS: Record<string, string> = {
  Gateway: 'gateways',
  VirtualService: 'virtualservices',
  DestinationRule: 'destinationrules',
};

// ── Service ───────────────────────────────────────────────────────────────────

export class KubernetesService {
  private clientCache = new Map<string, CachedClients>();
  private execSessions = new Map<string, ExecSession>();

  // ── Client management ─────────────────────────────────────────────────────

  private buildClients(cluster: ClusterRecord): CachedClients {
    const token = decrypt(cluster.token);
    const kc = new k8s.KubeConfig();
    kc.loadFromOptions({
      clusters: [{
        name: cluster.name,
        server: cluster.api_url,
        skipTLSVerify: cluster.skip_tls_verify === 1,
        caData: cluster.ca_cert ? decrypt(cluster.ca_cert) : undefined,
      }],
      users: [{ name: 'noc-user', token }],
      contexts: [{ name: cluster.name, cluster: cluster.name, user: 'noc-user' }],
      currentContext: cluster.name,
    });
    return {
      kc,
      coreV1: kc.makeApiClient(k8s.CoreV1Api),
      appsV1: kc.makeApiClient(k8s.AppsV1Api),
      networkingV1: kc.makeApiClient(k8s.NetworkingV1Api),
      customObjects: kc.makeApiClient(k8s.CustomObjectsApi),
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

  // ── Cluster CRUD ──────────────────────────────────────────────────────────

  listClusters(): K8sCluster[] {
    const rows = db.prepare('SELECT * FROM k8s_clusters ORDER BY name').all() as ClusterRecord[];
    return rows.map(r => ({
      id: r.id, name: r.name, apiUrl: r.api_url,
      skipTlsVerify: r.skip_tls_verify === 1,
      description: r.description ?? undefined,
      enabled: r.enabled === 1,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  createCluster(data: { name: string; apiUrl: string; token: string; caBase64?: string; skipTlsVerify?: boolean; description?: string }): K8sCluster {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO k8s_clusters (id, name, api_url, token, ca_cert, skip_tls_verify, description, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, data.name, data.apiUrl, encrypt(data.token), data.caBase64 ? encrypt(data.caBase64) : null, data.skipTlsVerify ? 1 : 0, data.description ?? null, now, now);
    logger.info(`K8s cluster created: ${data.name}`);
    return { id, name: data.name, apiUrl: data.apiUrl, skipTlsVerify: data.skipTlsVerify ?? false, description: data.description, enabled: true, createdAt: now, updatedAt: now };
  }

  updateCluster(id: string, data: { name?: string; apiUrl?: string; token?: string; caBase64?: string; skipTlsVerify?: boolean; description?: string; enabled?: boolean }): boolean {
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
    sets.push('updated_at = ?'); values.push(now, id);
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
      await this.getClients(cluster).coreV1.listNamespace();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.body?.message || e?.message || '连接失败' };
    }
  }

  // ── Core Resources ────────────────────────────────────────────────────────

  async listNamespaces(id: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = await this.getClients(cluster).coreV1.listNamespace();
    return (body.items || []).map(ns => ({ name: ns.metadata?.name ?? '', status: ns.status?.phase ?? 'Unknown', createdAt: ns.metadata?.creationTimestamp }));
  }

  async listNodes(id: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = await this.getClients(cluster).coreV1.listNode();
    return (body.items || []).map(node => {
      const readyCond = (node.status?.conditions || []).find(c => c.type === 'Ready');
      const roles = Object.keys(node.metadata?.labels || {}).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.replace('node-role.kubernetes.io/', ''));
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

  async listPods(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = namespace
      ? await this.getClients(cluster).coreV1.listNamespacedPod(namespace)
      : await this.getClients(cluster).coreV1.listPodForAllNamespaces();
    return (body.items || []).map(pod => {
      const cStatuses = pod.status?.containerStatuses || [];
      return {
        name: pod.metadata?.name ?? '',
        namespace: pod.metadata?.namespace ?? '',
        status: pod.status?.phase ?? 'Unknown',
        ready: `${cStatuses.filter(c => c.ready).length}/${cStatuses.length}`,
        restarts: cStatuses.reduce((s, c) => s + (c.restartCount || 0), 0),
        containers: (pod.spec?.containers || []).map(c => c.name),
        nodeName: pod.spec?.nodeName ?? '',
        podIP: pod.status?.podIP ?? '',
        createdAt: pod.metadata?.creationTimestamp,
      };
    });
  }

  async listDeployments(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = namespace
      ? await this.getClients(cluster).appsV1.listNamespacedDeployment(namespace)
      : await this.getClients(cluster).appsV1.listDeploymentForAllNamespaces();
    return (body.items || []).map(dep => ({
      name: dep.metadata?.name ?? '',
      namespace: dep.metadata?.namespace ?? '',
      ready: `${dep.status?.readyReplicas ?? 0}/${dep.spec?.replicas ?? 0}`,
      available: dep.status?.availableReplicas ?? 0,
      images: (dep.spec?.template?.spec?.containers || []).map(c => c.image ?? ''),
      createdAt: dep.metadata?.creationTimestamp,
    }));
  }

  async listServices(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = namespace
      ? await this.getClients(cluster).coreV1.listNamespacedService(namespace)
      : await this.getClients(cluster).coreV1.listServiceForAllNamespaces();
    return (body.items || []).map(svc => ({
      name: svc.metadata?.name ?? '',
      namespace: svc.metadata?.namespace ?? '',
      type: svc.spec?.type ?? '',
      clusterIP: svc.spec?.clusterIP ?? '',
      externalIP: (svc.status?.loadBalancer?.ingress || []).map(i => i.ip || i.hostname || '').filter(Boolean).join(', ') || '<none>',
      ports: (svc.spec?.ports || []).map(p => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol || 'TCP'}`).join(', '),
      createdAt: svc.metadata?.creationTimestamp,
    }));
  }

  // ── Ingress (Networking) ──────────────────────────────────────────────────

  async listIngresses(id: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = namespace
      ? await this.getClients(cluster).networkingV1.listNamespacedIngress(namespace)
      : await this.getClients(cluster).networkingV1.listIngressForAllNamespaces();
    return (body.items || []).map(ing => ({
      name: ing.metadata?.name ?? '',
      namespace: ing.metadata?.namespace ?? '',
      className: ing.spec?.ingressClassName ?? '',
      rules: (ing.spec?.rules || []).map(r => r.host ?? '*').join(', '),
      tls: (ing.spec?.tls || []).length > 0,
      createdAt: ing.metadata?.creationTimestamp,
    }));
  }

  // ── Istio (Custom Resources) ──────────────────────────────────────────────

  async listIstioResources(id: string, kind: string, namespace?: string) {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const plural = ISTIO_PLURALS[kind];
    if (!plural) throw new Error(`不支持的 Istio 资源类型: ${kind}`);

    const { body } = (namespace
      ? await this.getClients(cluster).customObjects.listNamespacedCustomObject(ISTIO_GROUP, ISTIO_VERSION, namespace, plural)
      : await this.getClients(cluster).customObjects.listClusterCustomObject(ISTIO_GROUP, ISTIO_VERSION, plural)) as any;

    return ((body as any).items || []).map((item: any) => ({
      name: item.metadata?.name ?? '',
      namespace: item.metadata?.namespace ?? '',
      createdAt: item.metadata?.creationTimestamp,
      // Kind-specific summary fields
      ...(kind === 'Gateway' ? {
        selector: JSON.stringify(item.spec?.selector ?? {}),
        servers: (item.spec?.servers || []).length,
      } : {}),
      ...(kind === 'VirtualService' ? {
        hosts: (item.spec?.hosts || []).join(', '),
        gateways: (item.spec?.gateways || []).join(', '),
      } : {}),
      ...(kind === 'DestinationRule' ? {
        host: item.spec?.host ?? '',
        trafficPolicy: item.spec?.trafficPolicy ? 'Defined' : 'None',
      } : {}),
    }));
  }

  // ── Resource Get / Edit ───────────────────────────────────────────────────

  async getResource(id: string, kind: string, namespace: string, name: string): Promise<object> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const clients = this.getClients(cluster);

    let raw: any;
    switch (kind) {
      case 'Deployment':
        raw = (await clients.appsV1.readNamespacedDeployment(name, namespace)).body; break;
      case 'Service':
        raw = (await clients.coreV1.readNamespacedService(name, namespace)).body; break;
      case 'Pod':
        raw = (await clients.coreV1.readNamespacedPod(name, namespace)).body; break;
      case 'Ingress':
        raw = (await clients.networkingV1.readNamespacedIngress(name, namespace)).body; break;
      case 'Gateway':
      case 'VirtualService':
      case 'DestinationRule':
        raw = (await clients.customObjects.getNamespacedCustomObject(ISTIO_GROUP, ISTIO_VERSION, namespace, ISTIO_PLURALS[kind], name)).body; break;
      default:
        throw new Error(`不支持的资源类型: ${kind}`);
    }

    // Strip noisy fields for cleaner editing
    if (raw.metadata) {
      delete raw.metadata.managedFields;
      delete raw.metadata.resourceVersion;
      delete raw.metadata.uid;
      delete raw.metadata.generation;
      delete raw.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration'];
    }
    if (raw.status && kind !== 'Gateway' && kind !== 'VirtualService' && kind !== 'DestinationRule') {
      delete raw.status;
    }
    return raw;
  }

  async replaceResource(id: string, kind: string, namespace: string, name: string, body: any): Promise<void> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const clients = this.getClients(cluster);

    switch (kind) {
      case 'Deployment':
        await clients.appsV1.replaceNamespacedDeployment(name, namespace, body); break;
      case 'Service':
        await clients.coreV1.replaceNamespacedService(name, namespace, body); break;
      case 'Ingress':
        await clients.networkingV1.replaceNamespacedIngress(name, namespace, body); break;
      case 'Gateway':
      case 'VirtualService':
      case 'DestinationRule':
        await clients.customObjects.replaceNamespacedCustomObject(ISTIO_GROUP, ISTIO_VERSION, namespace, ISTIO_PLURALS[kind], name, body); break;
      default:
        throw new Error(`不支持编辑资源类型: ${kind}`);
    }
  }

  // ── Resource Delete ───────────────────────────────────────────────────────

  async deleteResource(id: string, kind: string, namespace: string, name: string): Promise<void> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const clients = this.getClients(cluster);

    switch (kind) {
      case 'Deployment':
        await clients.appsV1.deleteNamespacedDeployment(name, namespace); break;
      case 'Service':
        await clients.coreV1.deleteNamespacedService(name, namespace); break;
      case 'Pod':
        await clients.coreV1.deleteNamespacedPod(name, namespace); break;
      case 'Ingress':
        await clients.networkingV1.deleteNamespacedIngress(name, namespace); break;
      case 'Gateway':
      case 'VirtualService':
      case 'DestinationRule':
        await clients.customObjects.deleteNamespacedCustomObject(ISTIO_GROUP, ISTIO_VERSION, namespace, ISTIO_PLURALS[kind], name); break;
      default:
        throw new Error(`不支持删除资源类型: ${kind}`);
    }
  }

  // ── Deployment Restart ────────────────────────────────────────────────────

  async restartDeployment(id: string, namespace: string, name: string): Promise<void> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const patch = {
      spec: {
        template: {
          metadata: {
            annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() },
          },
        },
      },
    };
    const options = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };
    await this.getClients(cluster).appsV1.patchNamespacedDeployment(name, namespace, patch, undefined, undefined, undefined, undefined, undefined, options);
  }

  // ── Pod Logs ──────────────────────────────────────────────────────────────

  async getPodLogs(id: string, namespace: string, podName: string, container?: string, tailLines = 200): Promise<string> {
    const cluster = this.getClusterRecord(id);
    if (!cluster) throw new Error('集群不存在');
    const { body } = await this.getClients(cluster).coreV1.readNamespacedPodLog(
      podName, namespace, container || undefined, false, undefined, undefined, undefined, false, undefined, tailLines, undefined
    );
    return typeof body === 'string' ? body : JSON.stringify(body);
  }

  // ── Pod Exec ──────────────────────────────────────────────────────────────

  async openExecSession(
    clusterId: string,
    namespace: string,
    podName: string,
    containerName: string,
    onData: (data: string) => void,
    onClose: () => void,
  ): Promise<string> {
    const cluster = this.getClusterRecord(clusterId);
    if (!cluster) throw new Error('集群不存在');

    const { kc } = this.getClients(cluster);
    const exec = new k8s.Exec(kc);

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    stdout.on('data', (d: Buffer) => onData(d.toString()));
    stderr.on('data', (d: Buffer) => onData(d.toString()));

    const ws = await exec.exec(
      namespace, podName, containerName || '',
      ['/bin/sh'], stdout, stderr, stdin, true
    );

    const sessionId = randomUUID();
    this.execSessions.set(sessionId, { sessionId, ws, stdin });

    ws.on('close', () => {
      this.execSessions.delete(sessionId);
      onClose();
    });

    ws.on('error', (err: Error) => {
      logger.error(`K8s exec session ${sessionId} error:`, err);
      this.execSessions.delete(sessionId);
      onClose();
    });

    return sessionId;
  }

  sendExecData(sessionId: string, data: string): void {
    const session = this.execSessions.get(sessionId);
    if (session) session.stdin.write(data);
  }

  resizeExecTerminal(sessionId: string, cols: number, rows: number): void {
    const session = this.execSessions.get(sessionId);
    if (!session?.ws) return;
    try {
      const msg = Buffer.concat([
        Buffer.from([4]), // channel 4 = resize
        Buffer.from(JSON.stringify({ Width: cols, Height: rows })),
      ]);
      session.ws.send(msg);
    } catch { /* ignore resize errors */ }
  }

  closeExecSession(sessionId: string): void {
    const session = this.execSessions.get(sessionId);
    if (!session) return;
    try { session.stdin.end(); } catch { /* ignore */ }
    try { session.ws.close(); } catch { /* ignore */ }
    this.execSessions.delete(sessionId);
  }
}

export const kubernetesService = new KubernetesService();
