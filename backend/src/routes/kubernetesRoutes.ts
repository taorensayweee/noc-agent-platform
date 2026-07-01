import { Router, Request, Response } from 'express';
import { kubernetesService } from '../services/kubernetesService';
import { requireRole } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

const handleErr = (res: Response, e: any, fallback = '操作失败') => {
  const msg = e?.body?.message || e?.message || fallback;
  logger.error(`K8s API error: ${msg}`);
  res.status(500).json({ success: false, error: msg });
};

// ── Cluster CRUD ──────────────────────────────────────────────────────────────

router.get('/clusters', (_req, res) => {
  try { res.json({ success: true, data: kubernetesService.listClusters() }); }
  catch (e: any) { handleErr(res, e); }
});

router.post('/clusters', requireRole('admin'), (req, res) => {
  const { name, apiUrl, token, caBase64, skipTlsVerify, description } = req.body;
  if (!name || !apiUrl || !token) return res.status(400).json({ success: false, error: '名称、API地址、Token 为必填项' });
  try { res.status(201).json({ success: true, data: kubernetesService.createCluster({ name, apiUrl, token, caBase64, skipTlsVerify, description }) }); }
  catch (e: any) { handleErr(res, e); }
});

router.put('/clusters/:id', requireRole('admin'), (req, res) => {
  const ok = kubernetesService.updateCluster(req.params.id, req.body);
  if (!ok) return res.status(404).json({ success: false, error: '集群不存在' });
  res.json({ success: true });
});

router.delete('/clusters/:id', requireRole('admin'), (req, res) => {
  const ok = kubernetesService.deleteCluster(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: '集群不存在' });
  res.json({ success: true });
});

router.post('/clusters/:id/test', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.testConnection(req.params.id) }); }
  catch (e: any) { handleErr(res, e); }
});

// ── Core Resources ─────────────────────────────────────────────────────────────

router.get('/clusters/:id/namespaces', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listNamespaces(req.params.id) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/nodes', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listNodes(req.params.id) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/pods', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listPods(req.params.id, req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/deployments', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listDeployments(req.params.id, req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/services', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listServices(req.params.id, req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/pods/:namespace/:podName/logs', async (req, res) => {
  const { id, namespace, podName } = req.params;
  try {
    const logs = await kubernetesService.getPodLogs(id, namespace, podName, req.query.container as string, parseInt(req.query.tail as string) || 200);
    res.json({ success: true, data: logs });
  } catch (e: any) { handleErr(res, e); }
});

// ── Ingress ────────────────────────────────────────────────────────────────────

router.get('/clusters/:id/ingresses', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listIngresses(req.params.id, req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

// ── Istio Resources ────────────────────────────────────────────────────────────

router.get('/clusters/:id/gateways', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listIstioResources(req.params.id, 'Gateway', req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/virtualservices', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listIstioResources(req.params.id, 'VirtualService', req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

router.get('/clusters/:id/destinationrules', async (req, res) => {
  try { res.json({ success: true, data: await kubernetesService.listIstioResources(req.params.id, 'DestinationRule', req.query.namespace as string) }); }
  catch (e: any) { handleErr(res, e); }
});

// ── Generic Resource Get / Edit / Delete ───────────────────────────────────────

router.get('/clusters/:id/resources/:kind/:namespace/:name', async (req, res) => {
  const { id, kind, namespace, name } = req.params;
  try { res.json({ success: true, data: await kubernetesService.getResource(id, kind, namespace, name) }); }
  catch (e: any) { handleErr(res, e); }
});

router.put('/clusters/:id/resources/:kind/:namespace/:name', requireRole('admin', 'operator'), async (req, res) => {
  const { id, kind, namespace, name } = req.params;
  try {
    await kubernetesService.replaceResource(id, kind, namespace, name, req.body);
    res.json({ success: true });
  } catch (e: any) { handleErr(res, e); }
});

router.delete('/clusters/:id/resources/:kind/:namespace/:name', requireRole('admin', 'operator'), async (req, res) => {
  const { id, kind, namespace, name } = req.params;
  try {
    await kubernetesService.deleteResource(id, kind, namespace, name);
    res.json({ success: true });
  } catch (e: any) { handleErr(res, e); }
});

// ── Deployment Restart ─────────────────────────────────────────────────────────

router.post('/clusters/:id/deployments/:namespace/:name/restart', requireRole('admin', 'operator'), async (req, res) => {
  const { id, namespace, name } = req.params;
  try {
    await kubernetesService.restartDeployment(id, namespace, name);
    res.json({ success: true });
  } catch (e: any) { handleErr(res, e); }
});

export default router;
