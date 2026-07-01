import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, RefreshCw, Trash2, Edit, CheckCircle2, XCircle, Loader2,
  Server, Box, Network, Layers, FileText, X, ChevronDown, Wifi, WifiOff,
  Settings, AlertTriangle, Terminal,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

interface K8sCluster {
  id: string;
  name: string;
  apiUrl: string;
  skipTlsVerify: boolean;
  description?: string;
  enabled: boolean;
  createdAt: string;
}

type Tab = 'nodes' | 'workloads' | 'pods' | 'services';

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status?.toLowerCase() ?? '';
  const cls = s === 'ready' || s === 'running' || s === 'active'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    : s === 'pending'
    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', cls)}>
      {status || 'Unknown'}
    </span>
  );
}

// ── Cluster Modal ─────────────────────────────────────────────────────────────

function ClusterModal({
  cluster,
  onClose,
  onSaved,
}: {
  cluster: K8sCluster | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: cluster?.name ?? '',
    apiUrl: cluster?.apiUrl ?? '',
    token: '',
    caBase64: '',
    skipTlsVerify: cluster?.skipTlsVerify ?? false,
    description: cluster?.description ?? '',
  });
  const [testing, setTesting] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      cluster
        ? api.put(`/api/k8s/clusters/${cluster.id}`, data)
        : api.post('/api/k8s/clusters', data),
    onSuccess: () => {
      toast.success(cluster ? '集群更新成功' : '集群添加成功');
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || '保存失败'),
  });

  const handleTest = async () => {
    if (!cluster) { toast.error('请先保存集群后再测试连接'); return; }
    setTesting(true);
    try {
      const res = await api.post(`/api/k8s/clusters/${cluster.id}/test`);
      if (res.data.data.ok) toast.success('连接成功');
      else toast.error(`连接失败: ${res.data.data.error}`);
    } catch {
      toast.error('测试失败');
    } finally {
      setTesting(false);
    }
  };

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {cluster ? '编辑集群' : '添加 K8s 集群'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">集群名称 *</label>
            <input
              value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="lab"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Server URL *</label>
            <input
              value={form.apiUrl} onChange={e => set('apiUrl', e.target.value)}
              placeholder="https://k8s.example.com:6443"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Bearer Token {cluster ? '(留空则不修改)' : '*'}
            </label>
            <textarea
              value={form.token} onChange={e => set('token', e.target.value)}
              rows={3}
              placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              CA Certificate (base64，可选)
            </label>
            <textarea
              value={form.caBase64} onChange={e => set('caBase64', e.target.value)}
              rows={2}
              placeholder="LS0tLS1CRUdJTi..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="skipTls" type="checkbox"
              checked={form.skipTlsVerify} onChange={e => set('skipTlsVerify', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <label htmlFor="skipTls" className="text-sm text-gray-700 dark:text-gray-300">跳过 TLS 验证（自签名证书集群）</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
            <input
              value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="自建 lab 集群"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleTest} disabled={!cluster || testing}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            测试连接
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">取消</button>
            <button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Log Drawer ────────────────────────────────────────────────────────────────

function LogDrawer({
  clusterId,
  namespace,
  podName,
  containers,
  onClose,
}: {
  clusterId: string;
  namespace: string;
  podName: string;
  containers: string[];
  onClose: () => void;
}) {
  const [container, setContainer] = useState(containers[0] ?? '');
  const [tail, setTail] = useState(200);
  const logRef = useRef<HTMLPreElement>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pod-logs', clusterId, namespace, podName, container, tail],
    queryFn: () =>
      api.get(`/api/k8s/clusters/${clusterId}/pods/${namespace}/${podName}/logs`, {
        params: { container, tail },
      }).then(r => r.data.data as string),
    refetchInterval: false,
  });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-gray-900 w-full max-w-5xl h-[70vh] rounded-t-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="text-white text-sm font-mono">{namespace}/{podName}</span>
            {containers.length > 1 && (
              <select
                value={container} onChange={e => setContainer(e.target.value)}
                className="bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded border border-gray-600"
              >
                {containers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select
              value={tail} onChange={e => setTail(Number(e.target.value))}
              className="bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded border border-gray-600"
            >
              {[100, 200, 500, 1000].map(n => <option key={n} value={n}>最近 {n} 行</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="text-gray-400 hover:text-white p-1">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <pre
          ref={logRef}
          className="flex-1 overflow-auto p-4 text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed"
        >
          {isLoading ? '加载中...' : data || '（无日志）'}
        </pre>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Kubernetes() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [selectedCluster, setSelectedCluster] = useState<string>('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [activeTab, setActiveTab] = useState<Tab>('nodes');
  const [showClusterModal, setShowClusterModal] = useState(false);
  const [editingCluster, setEditingCluster] = useState<K8sCluster | null>(null);
  const [logTarget, setLogTarget] = useState<{ namespace: string; podName: string; containers: string[] } | null>(null);
  const [showClusterList, setShowClusterList] = useState(false);

  // ── Data Queries ────────────────────────────────────────────────────────

  const { data: clusters = [], refetch: refetchClusters } = useQuery({
    queryKey: ['k8s-clusters'],
    queryFn: () => api.get('/api/k8s/clusters').then(r => r.data.data as K8sCluster[]),
  });

  const currentCluster = clusters.find(c => c.id === selectedCluster);

  useEffect(() => {
    if (clusters.length > 0 && !selectedCluster) {
      setSelectedCluster(clusters[0].id);
    }
  }, [clusters, selectedCluster]);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['k8s-namespaces', selectedCluster],
    queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/namespaces`).then(r => r.data.data),
    enabled: !!selectedCluster,
  });

  const nsParam = selectedNamespace || undefined;

  const { data: nodes = [], isFetching: fetchingNodes, refetch: refetchNodes } = useQuery({
    queryKey: ['k8s-nodes', selectedCluster],
    queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/nodes`).then(r => r.data.data),
    enabled: !!selectedCluster && activeTab === 'nodes',
  });

  const { data: deployments = [], isFetching: fetchingDeploys, refetch: refetchDeploys } = useQuery({
    queryKey: ['k8s-deployments', selectedCluster, nsParam],
    queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/deployments`, { params: { namespace: nsParam } }).then(r => r.data.data),
    enabled: !!selectedCluster && activeTab === 'workloads',
  });

  const { data: pods = [], isFetching: fetchingPods, refetch: refetchPods } = useQuery({
    queryKey: ['k8s-pods', selectedCluster, nsParam],
    queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/pods`, { params: { namespace: nsParam } }).then(r => r.data.data),
    enabled: !!selectedCluster && activeTab === 'pods',
  });

  const { data: services = [], isFetching: fetchingSvcs, refetch: refetchSvcs } = useQuery({
    queryKey: ['k8s-services', selectedCluster, nsParam],
    queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/services`, { params: { namespace: nsParam } }).then(r => r.data.data),
    enabled: !!selectedCluster && activeTab === 'services',
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/k8s/clusters/${id}`),
    onSuccess: () => { toast.success('集群删除成功'); refetchClusters(); },
    onError: () => toast.error('删除失败'),
  });

  const isLoading = fetchingNodes || fetchingDeploys || fetchingPods || fetchingSvcs;

  const handleRefresh = () => {
    if (activeTab === 'nodes') refetchNodes();
    else if (activeTab === 'workloads') refetchDeploys();
    else if (activeTab === 'pods') refetchPods();
    else refetchSvcs();
  };

  // ── Table helpers ───────────────────────────────────────────────────────

  const thCls = 'px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider';
  const tdCls = 'px-4 py-3 text-sm text-gray-900 dark:text-gray-200 whitespace-nowrap';
  const trCls = 'border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750';

  // ── Render ──────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'nodes', label: '节点', icon: <Server className="w-4 h-4" /> },
    { key: 'workloads', label: '工作负载', icon: <Layers className="w-4 h-4" /> },
    { key: 'pods', label: 'Pods', icon: <Box className="w-4 h-4" /> },
    { key: 'services', label: '服务', icon: <Network className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">K8s 集群管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Kubernetes 集群资源总览</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditingCluster(null); setShowClusterModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            添加集群
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Cluster selector */}
        <div className="relative">
          <button
            onClick={() => setShowClusterList(v => !v)}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 min-w-[160px]"
          >
            <Settings className="w-4 h-4 text-gray-400" />
            <span className="flex-1 text-left">{currentCluster?.name ?? '选择集群'}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
          {showClusterList && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 overflow-hidden">
              {clusters.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">暂无集群，请先添加</div>
              ) : clusters.map(c => (
                <div
                  key={c.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => { setSelectedCluster(c.id); setShowClusterList(false); setSelectedNamespace(''); }}
                >
                  <div className="flex items-center gap-2">
                    {c.id === selectedCluster
                      ? <CheckCircle2 className="w-4 h-4 text-blue-500" />
                      : <div className="w-4 h-4" />}
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{c.name}</div>
                      <div className="text-xs text-gray-400 truncate max-w-[180px]">{c.apiUrl}</div>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 ml-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingCluster(c); setShowClusterModal(true); setShowClusterList(false); }}
                        className="p-1 text-gray-400 hover:text-blue-500">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteMutation.mutate(c.id)}
                        className="p-1 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Namespace selector */}
        <select
          value={selectedNamespace}
          onChange={e => setSelectedNamespace(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300"
          disabled={!selectedCluster || activeTab === 'nodes'}
        >
          <option value="">全部 Namespace</option>
          {namespaces.map((ns: any) => (
            <option key={ns.name} value={ns.name}>{ns.name}</option>
          ))}
        </select>

        <button
          onClick={handleRefresh}
          disabled={!selectedCluster || isLoading}
          className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          刷新
        </button>

        {/* Connection status */}
        {currentCluster && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ml-auto">
            <Wifi className="w-3.5 h-3.5 text-green-500" />
            {currentCluster.apiUrl}
          </div>
        )}
      </div>

      {/* No cluster selected */}
      {!selectedCluster && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <AlertTriangle className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-lg font-medium">暂无集群</p>
          <p className="text-sm mt-1">请先点击「添加集群」配置 K8s 集群连接信息</p>
        </div>
      )}

      {selectedCluster && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                  activeTab === t.key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                )}
              >
                {t.icon} {t.label}
                {t.key === 'nodes' && nodes.length > 0 && (
                  <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-1.5 py-0.5 rounded-full">{nodes.length}</span>
                )}
                {t.key === 'pods' && pods.length > 0 && (
                  <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-1.5 py-0.5 rounded-full">{pods.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

            {/* Nodes */}
            {activeTab === 'nodes' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      {['名称', '角色', '状态', '内部 IP', 'CPU', '内存', '版本', '操作系统'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.length === 0 && !fetchingNodes ? (
                      <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">暂无数据</td></tr>
                    ) : nodes.map((n: any) => (
                      <tr key={n.name} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono font-medium')}>{n.name}</td>
                        <td className={tdCls}>{n.roles.join(', ')}</td>
                        <td className={tdCls}><StatusBadge status={n.status} /></td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{n.internalIP}</td>
                        <td className={tdCls}>{n.cpu}</td>
                        <td className={tdCls}>{n.memory}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{n.version}</td>
                        <td className={clsx(tdCls, 'text-xs text-gray-500 dark:text-gray-400')}>{n.os}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Workloads (Deployments) */}
            {activeTab === 'workloads' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      {['名称', 'Namespace', '就绪', '镜像'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.length === 0 && !fetchingDeploys ? (
                      <tr><td colSpan={4} className="text-center py-10 text-gray-400 text-sm">暂无数据</td></tr>
                    ) : deployments.map((d: any) => (
                      <tr key={`${d.namespace}/${d.name}`} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono font-medium')}>{d.name}</td>
                        <td className={tdCls}>
                          <span className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 text-xs px-2 py-0.5 rounded">
                            {d.namespace}
                          </span>
                        </td>
                        <td className={tdCls}>
                          <span className={clsx(
                            'font-mono text-xs font-medium',
                            d.ready === `${d.available}/${d.available}` ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
                          )}>{d.ready}</span>
                        </td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-500 dark:text-gray-400 max-w-xs truncate')}>
                          {d.images.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pods */}
            {activeTab === 'pods' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      {['名称', 'Namespace', '状态', '就绪', '重启', '节点', 'Pod IP', '日志'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pods.length === 0 && !fetchingPods ? (
                      <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">暂无数据</td></tr>
                    ) : pods.map((p: any) => (
                      <tr key={`${p.namespace}/${p.name}`} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono text-xs font-medium max-w-[220px] truncate')}>{p.name}</td>
                        <td className={tdCls}>
                          <span className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 text-xs px-2 py-0.5 rounded">
                            {p.namespace}
                          </span>
                        </td>
                        <td className={tdCls}><StatusBadge status={p.status} /></td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{p.ready}</td>
                        <td className={tdCls}>
                          <span className={clsx('text-xs font-mono', p.restarts > 0 ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400')}>
                            {p.restarts}
                          </span>
                        </td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-500 dark:text-gray-400 max-w-[160px] truncate')}>{p.nodeName}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-500 dark:text-gray-400')}>{p.podIP}</td>
                        <td className={tdCls}>
                          <button
                            onClick={() => setLogTarget({ namespace: p.namespace, podName: p.name, containers: p.containers })}
                            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <FileText className="w-3.5 h-3.5" /> 日志
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Services */}
            {activeTab === 'services' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      {['名称', 'Namespace', '类型', 'Cluster IP', '外部 IP', '端口'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {services.length === 0 && !fetchingSvcs ? (
                      <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">暂无数据</td></tr>
                    ) : services.map((s: any) => (
                      <tr key={`${s.namespace}/${s.name}`} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono font-medium')}>{s.name}</td>
                        <td className={tdCls}>
                          <span className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 text-xs px-2 py-0.5 rounded">
                            {s.namespace}
                          </span>
                        </td>
                        <td className={tdCls}>
                          <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-xs px-2 py-0.5 rounded">
                            {s.type}
                          </span>
                        </td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{s.clusterIP}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{s.externalIP}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-500 dark:text-gray-400')}>{s.ports}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </>
      )}

      {/* Modals */}
      {showClusterModal && (
        <ClusterModal
          cluster={editingCluster}
          onClose={() => { setShowClusterModal(false); setEditingCluster(null); }}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ['k8s-clusters'] }); refetchClusters(); }}
        />
      )}

      {logTarget && (
        <LogDrawer
          clusterId={selectedCluster}
          namespace={logTarget.namespace}
          podName={logTarget.podName}
          containers={logTarget.containers}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  );
}
