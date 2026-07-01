import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, RefreshCw, Trash2, Edit, CheckCircle2, Loader2,
  Server, Box, Network, Layers, FileText, X, ChevronDown,
  Wifi, Settings, AlertTriangle, Terminal, RotateCcw, Shield,
} from 'lucide-react';
import { Terminal as XTerm, IDisposable } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io, Socket } from 'socket.io-client';
import 'xterm/css/xterm.css';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import clsx from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

interface K8sCluster { id: string; name: string; apiUrl: string; skipTlsVerify: boolean; description?: string; enabled: boolean; createdAt: string; }

type Tab = 'nodes' | 'workloads' | 'pods' | 'services' | 'istio';
type IstioSubTab = 'ingress' | 'gateway' | 'virtualservice' | 'destinationrule';

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status?.toLowerCase() ?? '';
  const cls = s === 'ready' || s === 'running' || s === 'active' || s === 'active'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    : s === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  return <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', cls)}>{status || 'Unknown'}</span>;
}

function NsBadge({ ns }: { ns: string }) {
  return <span className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 text-xs px-2 py-0.5 rounded">{ns}</span>;
}

function EmptyRow({ cols }: { cols: number }) {
  return <tr><td colSpan={cols} className="text-center py-12 text-gray-400 text-sm">暂无数据</td></tr>;
}

const thCls = 'px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider';
const tdCls = 'px-4 py-3 text-sm text-gray-900 dark:text-gray-200';
const trCls = 'border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50';

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ name, kind, onConfirm, onCancel, loading }: { name: string; kind: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">确认删除</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">此操作不可撤销</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
          确定要删除 <span className="font-mono font-medium text-red-600 dark:text-red-400">{kind}/{name}</span> 吗？
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">取消</button>
          <button onClick={onConfirm} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Resource Editor ───────────────────────────────────────────────────────────

function ResourceEditor({ clusterId, kind, namespace, name, onClose }: { clusterId: string; kind: string; namespace: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const { isLoading } = useQuery({
    queryKey: ['k8s-resource', clusterId, kind, namespace, name],
    queryFn: () => api.get(`/api/k8s/clusters/${clusterId}/resources/${kind}/${namespace}/${name}`).then(r => {
      setBody(JSON.stringify(r.data.data, null, 2));
      return r.data.data;
    }),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(body);
      await api.put(`/api/k8s/clusters/${clusterId}/resources/${kind}/${namespace}/${name}`, parsed);
      toast.success('保存成功');
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || '保存失败，请检查 JSON 格式');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl mx-4 h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">编辑资源</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{kind} / {namespace} / {name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <textarea
              value={body} onChange={e => setBody(e.target.value)}
              className="w-full h-full font-mono text-xs bg-gray-900 text-green-300 p-4 rounded-lg border-0 outline-none resize-none leading-relaxed"
              spellCheck={false}
            />
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">取消</button>
          <button onClick={handleSave} disabled={saving || isLoading} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} 保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Log Drawer ────────────────────────────────────────────────────────────────

function LogDrawer({ clusterId, namespace, podName, containers, onClose }: { clusterId: string; namespace: string; podName: string; containers: string[]; onClose: () => void }) {
  const [container, setContainer] = useState(containers[0] ?? '');
  const [tail, setTail] = useState(200);
  const logRef = useRef<HTMLPreElement>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pod-logs', clusterId, namespace, podName, container, tail],
    queryFn: () => api.get(`/api/k8s/clusters/${clusterId}/pods/${namespace}/${podName}/logs`, { params: { container, tail } }).then(r => r.data.data as string),
  });

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-gray-900 w-full max-w-5xl h-[70vh] rounded-t-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-green-400" />
            <span className="text-white text-sm font-mono">{namespace}/{podName}</span>
            {containers.length > 1 && (
              <select value={container} onChange={e => setContainer(e.target.value)} className="bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded border border-gray-600">
                {containers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select value={tail} onChange={e => setTail(Number(e.target.value))} className="bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded border border-gray-600">
              {[100, 200, 500, 1000].map(n => <option key={n} value={n}>最近 {n} 行</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={() => refetch()} className="text-gray-400 hover:text-white p-1"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <pre ref={logRef} className="flex-1 overflow-auto p-4 text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
          {isLoading ? '加载中...' : data || '（无日志）'}
        </pre>
      </div>
    </div>
  );
}

// ── Exec Terminal ─────────────────────────────────────────────────────────────

function ExecTerminal({ clusterId, namespace, podName, containerName, token, onClose }: {
  clusterId: string; namespace: string; podName: string; containerName: string; token: string; onClose: () => void;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onDataRef = useRef<IDisposable | null>(null);
  const onResizeRef = useRef<IDisposable | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      cursorBlink: true, fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    const socket = io(undefined, { auth: { token }, transports: ['websocket'], timeout: 60000 });
    socketRef.current = socket;

    socket.on('connect', () => {
      const { cols, rows } = term;
      socket.emit('k8s:exec:open', { clusterId, namespace, podName, containerName, cols, rows }, (res: { sessionId?: string; error?: string }) => {
        if (res.error) { setStatus('error'); setErrMsg(res.error); return; }
        sessionIdRef.current = res.sessionId!;
        setStatus('connected');
        term.focus();
      });
    });

    socket.on('connect_error', (err) => { setStatus('error'); setErrMsg(err.message); });

    socket.on('k8s:exec:data', (data: { sessionId: string; data: string }) => {
      if (data.sessionId === sessionIdRef.current) term.write(data.data);
    });

    socket.on('k8s:exec:close', () => {
      term.write('\r\n\x1b[31m[会话已关闭]\x1b[0m\r\n');
      setStatus('error');
    });

    onDataRef.current = term.onData((data) => {
      if (sessionIdRef.current) socket.emit('k8s:exec:data', { sessionId: sessionIdRef.current, data });
    });

    onResizeRef.current = term.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) socket.emit('k8s:exec:resize', { sessionId: sessionIdRef.current, cols, rows });
    });

    const handleResize = () => { fit.fit(); };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      onDataRef.current?.dispose();
      onResizeRef.current?.dispose();
      if (sessionIdRef.current) socket.emit('k8s:exec:close', { sessionId: sessionIdRef.current });
      socket.disconnect();
      term.dispose();
    };
  }, []); // eslint-disable-line

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
      <div className="bg-gray-900 w-full max-w-5xl h-[75vh] rounded-t-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="text-white text-sm font-mono">{namespace}/{podName}</span>
            {containerName && <span className="text-gray-400 text-xs font-mono">容器: {containerName}</span>}
            <span className={clsx('text-xs px-2 py-0.5 rounded', status === 'connected' ? 'bg-green-900/50 text-green-400' : status === 'connecting' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400')}>
              {status === 'connected' ? '已连接' : status === 'connecting' ? '连接中...' : `错误: ${errMsg}`}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X className="w-5 h-5" /></button>
        </div>
        <div ref={termRef} className="flex-1 p-2 overflow-hidden" />
      </div>
    </div>
  );
}

// ── Cluster Modal ─────────────────────────────────────────────────────────────

function ClusterModal({ cluster, onClose, onSaved }: { cluster: K8sCluster | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: cluster?.name ?? '', apiUrl: cluster?.apiUrl ?? '', token: '', caBase64: '', skipTlsVerify: cluster?.skipTlsVerify ?? false, description: cluster?.description ?? '' });
  const [testing, setTesting] = useState(false);
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => cluster ? api.put(`/api/k8s/clusters/${cluster.id}`, data) : api.post('/api/k8s/clusters', data),
    onSuccess: () => { toast.success(cluster ? '集群更新成功' : '集群添加成功'); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || '保存失败'),
  });

  const handleTest = async () => {
    if (!cluster) { toast.error('请先保存集群后再测试'); return; }
    setTesting(true);
    try {
      const res = await api.post(`/api/k8s/clusters/${cluster.id}/test`);
      res.data.data.ok ? toast.success('连接成功') : toast.error(`连接失败: ${res.data.data.error}`);
    } catch { toast.error('测试失败'); } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{cluster ? '编辑集群' : '添加 K8s 集群'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          {[['集群名称 *', 'name', 'lab', 'text'], ['API Server URL *', 'apiUrl', 'https://k8s.example.com:6443', 'text']].map(([label, key, ph, type]) => (
            <div key={key as string}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
              <input value={(form as any)[key as string]} onChange={e => set(key as string, e.target.value)} placeholder={ph as string} type={type as string}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bearer Token {cluster ? '(留空不修改)' : '*'}</label>
            <textarea value={form.token} onChange={e => set('token', e.target.value)} rows={3} placeholder="eyJhbGci..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CA Certificate (base64, 可选)</label>
            <textarea value={form.caBase64} onChange={e => set('caBase64', e.target.value)} rows={2} placeholder="LS0tLS1CRUdJTi..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex items-center gap-2">
            <input id="skipTls" type="checkbox" checked={form.skipTlsVerify} onChange={e => set('skipTlsVerify', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <label htmlFor="skipTls" className="text-sm text-gray-700 dark:text-gray-300">跳过 TLS 验证（自签名证书）</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="自建 lab 集群"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={handleTest} disabled={!cluster || testing} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />} 测试连接
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">取消</button>
            <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Kubernetes() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const token = localStorage.getItem('token') ?? '';
  const isAdmin = user?.role === 'admin';
  const canWrite = user?.role === 'admin' || user?.role === 'operator';

  const [selectedCluster, setSelectedCluster] = useState('');
  const [selectedNs, setSelectedNs] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('nodes');
  const [istioSub, setIstioSub] = useState<IstioSubTab>('ingress');
  const [showClusterList, setShowClusterList] = useState(false);
  const [showClusterModal, setShowClusterModal] = useState(false);
  const [editingCluster, setEditingCluster] = useState<K8sCluster | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ kind: string; namespace: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Editor state
  const [editorTarget, setEditorTarget] = useState<{ kind: string; namespace: string; name: string } | null>(null);

  // Log state
  const [logTarget, setLogTarget] = useState<{ namespace: string; podName: string; containers: string[] } | null>(null);

  // Exec state
  const [execTarget, setExecTarget] = useState<{ namespace: string; podName: string; containerName: string } | null>(null);

  // Container picker for exec when pod has multiple containers
  const [containerPickerPod, setContainerPickerPod] = useState<{ namespace: string; podName: string; containers: string[] } | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: clusters = [], refetch: refetchClusters } = useQuery({
    queryKey: ['k8s-clusters'],
    queryFn: () => api.get('/api/k8s/clusters').then(r => r.data.data as K8sCluster[]),
  });

  const currentCluster = clusters.find(c => c.id === selectedCluster);

  useEffect(() => {
    if (clusters.length > 0 && !selectedCluster) setSelectedCluster(clusters[0].id);
  }, [clusters, selectedCluster]);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['k8s-namespaces', selectedCluster],
    queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/namespaces`).then(r => r.data.data),
    enabled: !!selectedCluster,
  });

  const nsParam = selectedNs || undefined;
  const enabled = !!selectedCluster;

  const { data: nodes = [], isFetching: fNodes, refetch: rNodes } = useQuery({ queryKey: ['k8s-nodes', selectedCluster], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/nodes`).then(r => r.data.data), enabled: enabled && activeTab === 'nodes' });
  const { data: deployments = [], isFetching: fDeploys, refetch: rDeploys } = useQuery({ queryKey: ['k8s-deployments', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/deployments`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'workloads' });
  const { data: pods = [], isFetching: fPods, refetch: rPods } = useQuery({ queryKey: ['k8s-pods', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/pods`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'pods' });
  const { data: services = [], isFetching: fSvcs, refetch: rSvcs } = useQuery({ queryKey: ['k8s-services', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/services`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'services' });
  const { data: ingresses = [], isFetching: fIngresses, refetch: rIngresses } = useQuery({ queryKey: ['k8s-ingresses', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/ingresses`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'istio' && istioSub === 'ingress' });
  const { data: gateways = [], isFetching: fGateways, refetch: rGateways } = useQuery({ queryKey: ['k8s-gateways', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/gateways`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'istio' && istioSub === 'gateway' });
  const { data: virtualServices = [], isFetching: fVS, refetch: rVS } = useQuery({ queryKey: ['k8s-vs', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/virtualservices`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'istio' && istioSub === 'virtualservice' });
  const { data: destRules = [], isFetching: fDR, refetch: rDR } = useQuery({ queryKey: ['k8s-dr', selectedCluster, nsParam], queryFn: () => api.get(`/api/k8s/clusters/${selectedCluster}/destinationrules`, { params: { namespace: nsParam } }).then(r => r.data.data), enabled: enabled && activeTab === 'istio' && istioSub === 'destinationrule' });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/k8s/clusters/${id}`),
    onSuccess: () => { toast.success('集群删除成功'); refetchClusters(); },
    onError: () => toast.error('删除失败'),
  });

  const restartMutation = useMutation({
    mutationFn: ({ namespace, name }: { namespace: string; name: string }) =>
      api.post(`/api/k8s/clusters/${selectedCluster}/deployments/${namespace}/${name}/restart`),
    onSuccess: () => { toast.success('已触发滚动重启'); queryClient.invalidateQueries({ queryKey: ['k8s-deployments'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.error || '重启失败'),
  });

  const isLoading = fNodes || fDeploys || fPods || fSvcs || fIngresses || fGateways || fVS || fDR;

  const handleRefresh = useCallback(() => {
    if (activeTab === 'nodes') rNodes();
    else if (activeTab === 'workloads') rDeploys();
    else if (activeTab === 'pods') rPods();
    else if (activeTab === 'services') rSvcs();
    else if (activeTab === 'istio') {
      if (istioSub === 'ingress') rIngresses();
      else if (istioSub === 'gateway') rGateways();
      else if (istioSub === 'virtualservice') rVS();
      else rDR();
    }
  }, [activeTab, istioSub, rNodes, rDeploys, rPods, rSvcs, rIngresses, rGateways, rVS, rDR]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/k8s/clusters/${selectedCluster}/resources/${deleteTarget.kind}/${deleteTarget.namespace}/${deleteTarget.name}`);
      toast.success('删除成功');
      setDeleteTarget(null);
      handleRefresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || '删除失败');
    } finally { setDeleting(false); }
  };

  const openExec = (namespace: string, podName: string, containers: string[]) => {
    if (containers.length <= 1) setExecTarget({ namespace, podName, containerName: containers[0] ?? '' });
    else setContainerPickerPod({ namespace, podName, containers });
  };

  // ── Tabs ─────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'nodes', label: '节点', icon: <Server className="w-4 h-4" />, count: nodes.length || undefined },
    { key: 'workloads', label: '工作负载', icon: <Layers className="w-4 h-4" />, count: deployments.length || undefined },
    { key: 'pods', label: 'Pods', icon: <Box className="w-4 h-4" />, count: pods.length || undefined },
    { key: 'services', label: '服务', icon: <Network className="w-4 h-4" />, count: services.length || undefined },
    { key: 'istio', label: 'Istio', icon: <Shield className="w-4 h-4" /> },
  ];

  const istioSubTabs: { key: IstioSubTab; label: string }[] = [
    { key: 'ingress', label: 'Ingress' },
    { key: 'gateway', label: 'Gateway' },
    { key: 'virtualservice', label: 'VirtualService' },
    { key: 'destinationrule', label: 'DestinationRule' },
  ];

  // ── Action buttons ────────────────────────────────────────────────────────

  const actionBtn = (icon: React.ReactNode, label: string, onClick: () => void, color = 'text-blue-600 dark:text-blue-400') => (
    <button onClick={onClick} title={label} className={clsx('p-1 hover:opacity-70 transition-opacity', color)}>{icon}</button>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">K8s 集群管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Kubernetes 集群资源总览与操作</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setEditingCluster(null); setShowClusterModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> 添加集群
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Cluster selector */}
        <div className="relative">
          <button onClick={() => setShowClusterList(v => !v)} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 min-w-[160px]">
            <Settings className="w-4 h-4 text-gray-400" />
            <span className="flex-1 text-left">{currentCluster?.name ?? '选择集群'}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
          {showClusterList && (
            <div className="absolute top-full left-0 mt-1 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 overflow-hidden">
              {clusters.length === 0
                ? <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">暂无集群</div>
                : clusters.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => { setSelectedCluster(c.id); setShowClusterList(false); setSelectedNs(''); }}>
                    <div className="flex items-center gap-2">
                      {c.id === selectedCluster ? <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" /> : <div className="w-4 h-4 shrink-0" />}
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{c.name}</div>
                        <div className="text-xs text-gray-400 truncate max-w-[200px]">{c.apiUrl}</div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditingCluster(c); setShowClusterModal(true); setShowClusterList(false); }} className="p-1 text-gray-400 hover:text-blue-500"><Edit className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteMutation.mutate(c.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        <select value={selectedNs} onChange={e => setSelectedNs(e.target.value)} disabled={!selectedCluster || activeTab === 'nodes'} className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 disabled:opacity-50">
          <option value="">全部 Namespace</option>
          {namespaces.map((ns: any) => <option key={ns.name} value={ns.name}>{ns.name}</option>)}
        </select>

        <button onClick={handleRefresh} disabled={!selectedCluster || isLoading} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} /> 刷新
        </button>

        {currentCluster && <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-400"><Wifi className="w-3.5 h-3.5 text-green-500" />{currentCluster.apiUrl}</div>}
      </div>

      {!selectedCluster ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <AlertTriangle className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-lg font-medium">暂无集群</p>
          <p className="text-sm mt-1">请先点击「添加集群」配置连接信息</p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} className={clsx('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors', activeTab === t.key ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300')}>
                {t.icon} {t.label}
                {t.count ? <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-1.5 py-0.5 rounded-full">{t.count}</span> : null}
              </button>
            ))}
          </div>

          {/* Istio sub-tabs */}
          {activeTab === 'istio' && (
            <div className="flex gap-2">
              {istioSubTabs.map(s => (
                <button key={s.key} onClick={() => setIstioSub(s.key)} className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors', istioSub === s.key ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600')}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Content table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

            {/* Nodes */}
            {activeTab === 'nodes' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['名称', '角色', '状态', '内部 IP', 'CPU', '内存', '版本', '操作系统'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {nodes.length === 0 && !fNodes ? <EmptyRow cols={8} /> : nodes.map((n: any) => (
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

            {/* Workloads */}
            {activeTab === 'workloads' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['名称', 'Namespace', '就绪', '镜像', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {deployments.length === 0 && !fDeploys ? <EmptyRow cols={5} /> : deployments.map((d: any) => (
                      <tr key={`${d.namespace}/${d.name}`} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono font-medium')}>{d.name}</td>
                        <td className={tdCls}><NsBadge ns={d.namespace} /></td>
                        <td className={tdCls}><span className={clsx('font-mono text-xs font-medium', d.ready.startsWith(d.available) ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400')}>{d.ready}</span></td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-400 max-w-xs truncate')}>{d.images.join(', ')}</td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-1">
                            {canWrite && actionBtn(<RotateCcw className="w-4 h-4" />, '滚动重启', () => restartMutation.mutate({ namespace: d.namespace, name: d.name }))}
                            {canWrite && actionBtn(<Edit className="w-4 h-4" />, '编辑', () => setEditorTarget({ kind: 'Deployment', namespace: d.namespace, name: d.name }))}
                            {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'Deployment', namespace: d.namespace, name: d.name }), 'text-red-500 dark:text-red-400')}
                          </div>
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
                    <tr>{['名称', 'Namespace', '状态', '就绪', '重启', '节点', 'Pod IP', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {pods.length === 0 && !fPods ? <EmptyRow cols={8} /> : pods.map((p: any) => (
                      <tr key={`${p.namespace}/${p.name}`} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono text-xs font-medium max-w-[200px] truncate')}>{p.name}</td>
                        <td className={tdCls}><NsBadge ns={p.namespace} /></td>
                        <td className={tdCls}><StatusBadge status={p.status} /></td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{p.ready}</td>
                        <td className={tdCls}><span className={clsx('text-xs font-mono', p.restarts > 0 ? 'text-orange-500' : 'text-gray-400')}>{p.restarts}</span></td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-400 max-w-[140px] truncate')}>{p.nodeName}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-400')}>{p.podIP}</td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-1">
                            {actionBtn(<Terminal className="w-4 h-4" />, '进入容器', () => openExec(p.namespace, p.name, p.containers), 'text-green-600 dark:text-green-400')}
                            {actionBtn(<FileText className="w-4 h-4" />, '日志', () => setLogTarget({ namespace: p.namespace, podName: p.name, containers: p.containers }))}
                            {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'Pod', namespace: p.namespace, name: p.name }), 'text-red-500 dark:text-red-400')}
                          </div>
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
                    <tr>{['名称', 'Namespace', '类型', 'Cluster IP', '外部 IP', '端口', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {services.length === 0 && !fSvcs ? <EmptyRow cols={7} /> : services.map((s: any) => (
                      <tr key={`${s.namespace}/${s.name}`} className={trCls}>
                        <td className={clsx(tdCls, 'font-mono font-medium')}>{s.name}</td>
                        <td className={tdCls}><NsBadge ns={s.namespace} /></td>
                        <td className={tdCls}><span className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-xs px-2 py-0.5 rounded">{s.type}</span></td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{s.clusterIP}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs')}>{s.externalIP}</td>
                        <td className={clsx(tdCls, 'font-mono text-xs text-gray-400')}>{s.ports}</td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-1">
                            {canWrite && actionBtn(<Edit className="w-4 h-4" />, '编辑', () => setEditorTarget({ kind: 'Service', namespace: s.namespace, name: s.name }))}
                            {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'Service', namespace: s.namespace, name: s.name }), 'text-red-500 dark:text-red-400')}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Istio */}
            {activeTab === 'istio' && (
              <div className="overflow-x-auto">
                {/* Ingress */}
                {istioSub === 'ingress' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>{['名称', 'Namespace', 'IngressClass', 'Hosts', 'TLS', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {ingresses.length === 0 && !fIngresses ? <EmptyRow cols={6} /> : ingresses.map((ing: any) => (
                        <tr key={`${ing.namespace}/${ing.name}`} className={trCls}>
                          <td className={clsx(tdCls, 'font-mono font-medium')}>{ing.name}</td>
                          <td className={tdCls}><NsBadge ns={ing.namespace} /></td>
                          <td className={clsx(tdCls, 'font-mono text-xs')}>{ing.className || '-'}</td>
                          <td className={clsx(tdCls, 'font-mono text-xs text-gray-400 max-w-xs truncate')}>{ing.rules || '-'}</td>
                          <td className={tdCls}>{ing.tls ? <span className="text-green-600 dark:text-green-400 text-xs">TLS</span> : '-'}</td>
                          <td className={tdCls}>
                            <div className="flex gap-1">
                              {canWrite && actionBtn(<Edit className="w-4 h-4" />, '编辑', () => setEditorTarget({ kind: 'Ingress', namespace: ing.namespace, name: ing.name }))}
                              {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'Ingress', namespace: ing.namespace, name: ing.name }), 'text-red-500 dark:text-red-400')}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Gateway */}
                {istioSub === 'gateway' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>{['名称', 'Namespace', 'Selector', 'Servers', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {gateways.length === 0 && !fGateways ? <EmptyRow cols={5} /> : gateways.map((gw: any) => (
                        <tr key={`${gw.namespace}/${gw.name}`} className={trCls}>
                          <td className={clsx(tdCls, 'font-mono font-medium')}>{gw.name}</td>
                          <td className={tdCls}><NsBadge ns={gw.namespace} /></td>
                          <td className={clsx(tdCls, 'font-mono text-xs text-gray-400')}>{gw.selector}</td>
                          <td className={tdCls}>{gw.servers}</td>
                          <td className={tdCls}>
                            <div className="flex gap-1">
                              {canWrite && actionBtn(<Edit className="w-4 h-4" />, '编辑', () => setEditorTarget({ kind: 'Gateway', namespace: gw.namespace, name: gw.name }))}
                              {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'Gateway', namespace: gw.namespace, name: gw.name }), 'text-red-500 dark:text-red-400')}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* VirtualService */}
                {istioSub === 'virtualservice' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>{['名称', 'Namespace', 'Hosts', 'Gateways', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {virtualServices.length === 0 && !fVS ? <EmptyRow cols={5} /> : virtualServices.map((vs: any) => (
                        <tr key={`${vs.namespace}/${vs.name}`} className={trCls}>
                          <td className={clsx(tdCls, 'font-mono font-medium')}>{vs.name}</td>
                          <td className={tdCls}><NsBadge ns={vs.namespace} /></td>
                          <td className={clsx(tdCls, 'font-mono text-xs text-gray-400 max-w-xs truncate')}>{vs.hosts}</td>
                          <td className={clsx(tdCls, 'font-mono text-xs text-gray-400 max-w-xs truncate')}>{vs.gateways || '-'}</td>
                          <td className={tdCls}>
                            <div className="flex gap-1">
                              {canWrite && actionBtn(<Edit className="w-4 h-4" />, '编辑', () => setEditorTarget({ kind: 'VirtualService', namespace: vs.namespace, name: vs.name }))}
                              {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'VirtualService', namespace: vs.namespace, name: vs.name }), 'text-red-500 dark:text-red-400')}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* DestinationRule */}
                {istioSub === 'destinationrule' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>{['名称', 'Namespace', 'Host', 'Traffic Policy', '操作'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {destRules.length === 0 && !fDR ? <EmptyRow cols={5} /> : destRules.map((dr: any) => (
                        <tr key={`${dr.namespace}/${dr.name}`} className={trCls}>
                          <td className={clsx(tdCls, 'font-mono font-medium')}>{dr.name}</td>
                          <td className={tdCls}><NsBadge ns={dr.namespace} /></td>
                          <td className={clsx(tdCls, 'font-mono text-xs')}>{dr.host}</td>
                          <td className={tdCls}>{dr.trafficPolicy}</td>
                          <td className={tdCls}>
                            <div className="flex gap-1">
                              {canWrite && actionBtn(<Edit className="w-4 h-4" />, '编辑', () => setEditorTarget({ kind: 'DestinationRule', namespace: dr.namespace, name: dr.name }))}
                              {canWrite && actionBtn(<Trash2 className="w-4 h-4" />, '删除', () => setDeleteTarget({ kind: 'DestinationRule', namespace: dr.namespace, name: dr.name }), 'text-red-500 dark:text-red-400')}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Container picker */}
      {containerPickerPod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-80 mx-4 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">选择容器</h3>
            <div className="space-y-2">
              {containerPickerPod.containers.map(c => (
                <button key={c} onClick={() => { setExecTarget({ namespace: containerPickerPod.namespace, podName: containerPickerPod.podName, containerName: c }); setContainerPickerPod(null); }}
                  className="w-full text-left px-4 py-2 rounded-lg text-sm font-mono text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600">
                  {c}
                </button>
              ))}
            </div>
            <button onClick={() => setContainerPickerPod(null)} className="mt-4 w-full text-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">取消</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showClusterModal && <ClusterModal cluster={editingCluster} onClose={() => { setShowClusterModal(false); setEditingCluster(null); }} onSaved={() => { queryClient.invalidateQueries({ queryKey: ['k8s-clusters'] }); refetchClusters(); }} />}
      {deleteTarget && <DeleteConfirm name={deleteTarget.name} kind={deleteTarget.kind} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />}
      {editorTarget && <ResourceEditor clusterId={selectedCluster} kind={editorTarget.kind} namespace={editorTarget.namespace} name={editorTarget.name} onClose={() => setEditorTarget(null)} />}
      {logTarget && <LogDrawer clusterId={selectedCluster} namespace={logTarget.namespace} podName={logTarget.podName} containers={logTarget.containers} onClose={() => setLogTarget(null)} />}
      {execTarget && <ExecTerminal clusterId={selectedCluster} namespace={execTarget.namespace} podName={execTarget.podName} containerName={execTarget.containerName} token={token} onClose={() => setExecTarget(null)} />}
    </div>
  );
}
