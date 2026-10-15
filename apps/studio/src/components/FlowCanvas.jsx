import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType } from '@xyflow/react';
import { applyFlowMeasurements, connectFlowOperation, disconnectFlowOperation, flowGraphEdges } from '../flow-graph.js';
import { useI18n } from '../i18n.js';

function FlowNode({ data }) {
  return <div className={`flow-graph-node ${data.isTrigger ? 'flow-graph-trigger' : ''} ${data.status ? `flow-node-${data.status}` : ''}`}>
    {!data.isTrigger && <Handle type="target" position={Position.Left} id="input" aria-label={data.labels.input} />}
    <span className="flow-node-kind">{data.kind}</span><strong>{data.label}</strong><code>{data.operationKey}</code>
    <div className="flow-node-ports"><span>{data.labels.resolve}</span>{!data.isTrigger && <span>{data.labels.reject}</span>}</div>
    <Handle type="source" position={Position.Right} id="resolve" className="flow-port-resolve" aria-label={data.labels.resolve} />
    {!data.isTrigger && <Handle type="source" position={Position.Right} id="reject" className="flow-port-reject" aria-label={data.labels.reject} />}
  </div>;
}
const NODE_TYPES = { flow: FlowNode };

export function FlowCanvas({ flow, selected, onSelect, onChange, onError, trace = [], disabled = false }) {
  const { t } = useI18n();
  const [dimensions, setDimensions] = useState(() => ({ flowId: flow.id, nodes: new Map() }));
  const measured = dimensions.flowId === flow.id ? dimensions.nodes : new Map();
  const traceStatusKey = JSON.stringify(trace.map(step => [step.id, step.status]));
  const statuses = useMemo(() => new Map(JSON.parse(traceStatusKey)), [traceStatusKey]);
  const nodes = useMemo(() => {
    const labels = { input: t('flow.input'), resolve: t('flow.resolve'), reject: t('flow.reject') };
    return [
    { id: 'trigger', type: 'flow', position: { x: 40, y: 100 }, measured: measured.get('trigger'), draggable: false, selected: selected === 'trigger', data: { label: t(`flow.trigger.${flow.trigger}`), kind: t('flow.triggerLabel'), operationKey: '$trigger', isTrigger: true, labels } },
    ...flow.operations.map(node => ({ id: node.id, type: 'flow', position: node.position, measured: measured.get(node.id), selected: selected === node.id,
      data: { label: node.name || node.key, kind: t(`flow.operation.${node.type}`), operationKey: node.key, labels, status: statuses.get(node.id) } })),
    ];
  }, [flow, selected, measured, statuses, t]);
  const edges = useMemo(() => flowGraphEdges(flow).map(edge => ({ ...edge, targetHandle: 'input', className: `flow-edge-${edge.data.branch}`,
    markerEnd: { type: MarkerType.ArrowClosed }, label: t(`flow.${edge.data.branch}`), type: 'smoothstep' })), [flow, t]);
  function connect(connection) { try { onChange(connectFlowOperation(flow, connection)); } catch (error) { onError(error); } }
  return <div className="flow-canvas" data-testid="flow-canvas" aria-label={t('flow.canvas')}>
    <ReactFlow key={`${flow.id ?? 'new'}:${flow.operations.length}`} nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView minZoom={0.2} maxZoom={1.6} deleteKeyCode={null}
      nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={false}
      onNodeClick={(_event, node) => onSelect(node.id)}
      onNodesChange={changes => {
        // Controlled nodes must retain measured dimensions across selection/history rerenders.
        setDimensions(previous => {
          const current = previous.flowId === flow.id ? previous.nodes : new Map();
          const next = applyFlowMeasurements(current, changes);
          return next === current && previous.flowId === flow.id ? previous : { flowId: flow.id, nodes: next };
        });
        if (disabled || !changes.some(change => change.type === 'position' && change.position)) return;
        const positions = new Map(changes.filter(change => change.type === 'position' && change.position).map(change => [change.id, change.position]));
        onChange({ ...flow, operations: flow.operations.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id) } : node) });
      }}
      onConnect={connect} isValidConnection={connection => { try { connectFlowOperation(flow, connection); return !disabled; } catch { return false; } }}
      onEdgeDoubleClick={(_event, edge) => { if (!disabled) onChange(disconnectFlowOperation(flow, edge.source, edge.data.branch)); }}
    ><Background /><Controls /><MiniMap pannable zoomable /></ReactFlow>
  </div>;
}
