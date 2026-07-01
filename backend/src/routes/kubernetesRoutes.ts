import { Router, Request, Response } from 'express';
import { kubernetesService } from '../services/kubernetesService';
import { requireRole } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// ── Cluster CRUD ──────────────────────────────────────────────────────────────

router.get('/clusters', (_req: Request, res: Response) => {
  try {
    const clusters = kubernetesService.listClusters();
    res.json({ success: true, data: clusters });
  } catch (e: any) {
    logger.error('List k8s clusters error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/clusters', requireRole('admin'), (req: Request, res: Response) => {
  const { name, apiUrl, token, caBase64, skipTlsVerify, description } = req.body;
  if (!name || !apiUrl || !token) {
    return res.status(400).json({ success: false, error: '名称、API地址、Token 为必填项' });
  }
  try {
    const cluster = kubernetesService.createCluster({ name, apiUrl, token, caBase64, skipTlsVerify, description });
    res.status(201).json({ success: true, data: cluster });
  } catch (e: any) {
    logger.error('Create k8s cluster error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/clusters/:id', requireRole('admin'), (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const ok = kubernetesService.updateCluster(id, req.body);
    if (!ok) return res.status(404).json({ success: false, error: '集群不存在' });
    res.json({ success: true });
  } catch (e: any) {
    logger.error('Update k8s cluster error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/clusters/:id', requireRole('admin'), (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const ok = kubernetesService.deleteCluster(id);
    if (!ok) return res.status(404).json({ success: false, error: '集群不存在' });
    res.json({ success: true });
  } catch (e: any) {
    logger.error('Delete k8s cluster error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/clusters/:id/test', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await kubernetesService.testConnection(id);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── K8s Resources ─────────────────────────────────────────────────────────────

router.get('/clusters/:id/namespaces', async (_req: Request, res: Response) => {
  try {
    const data = await kubernetesService.listNamespaces(_req.params.id);
    res.json({ success: true, data });
  } catch (e: any) {
    logger.error('List namespaces error:', e);
    res.status(500).json({ success: false, error: e?.body?.message || e.message });
  }
});

router.get('/clusters/:id/nodes', async (req: Request, res: Response) => {
  try {
    const data = await kubernetesService.listNodes(req.params.id);
    res.json({ success: true, data });
  } catch (e: any) {
    logger.error('List nodes error:', e);
    res.status(500).json({ success: false, error: e?.body?.message || e.message });
  }
});

router.get('/clusters/:id/pods', async (req: Request, res: Response) => {
  const namespace = req.query.namespace as string | undefined;
  try {
    const data = await kubernetesService.listPods(req.params.id, namespace);
    res.json({ success: true, data });
  } catch (e: any) {
    logger.error('List pods error:', e);
    res.status(500).json({ success: false, error: e?.body?.message || e.message });
  }
});

router.get('/clusters/:id/deployments', async (req: Request, res: Response) => {
  const namespace = req.query.namespace as string | undefined;
  try {
    const data = await kubernetesService.listDeployments(req.params.id, namespace);
    res.json({ success: true, data });
  } catch (e: any) {
    logger.error('List deployments error:', e);
    res.status(500).json({ success: false, error: e?.body?.message || e.message });
  }
});

router.get('/clusters/:id/services', async (req: Request, res: Response) => {
  const namespace = req.query.namespace as string | undefined;
  try {
    const data = await kubernetesService.listServices(req.params.id, namespace);
    res.json({ success: true, data });
  } catch (e: any) {
    logger.error('List services error:', e);
    res.status(500).json({ success: false, error: e?.body?.message || e.message });
  }
});

router.get('/clusters/:id/pods/:namespace/:podName/logs', async (req: Request, res: Response) => {
  const { id, namespace, podName } = req.params;
  const container = req.query.container as string | undefined;
  const tail = parseInt(req.query.tail as string) || 200;
  try {
    const logs = await kubernetesService.getPodLogs(id, namespace, podName, container, tail);
    res.json({ success: true, data: logs });
  } catch (e: any) {
    logger.error('Get pod logs error:', e);
    res.status(500).json({ success: false, error: e?.body?.message || e.message });
  }
});

export default router;
