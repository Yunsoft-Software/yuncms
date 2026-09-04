import { useMemo, useState } from 'react';

import { collectionUi } from '../collection-ui.js';
import { displaySchemaName } from '../schema-name.js';
import { CollectionIcon } from './CollectionIcon.jsx';

const NODE_WIDTH = 188;
const NODE_HEIGHT = 82;
const GAP_X = 84;
const GAP_Y = 54;
const PADDING = 34;

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) ?? {}; } catch { return {}; }
}

function graphRelationKind(relation) {
  return parseMetadata(relation?.metadata).kind || 'm2o';
}

function buildGraphModel(collections, relations) {
  const ordered = [...collections].sort((left, right) => {
    const leftOrder = collectionUi(left).sort;
    const rightOrder = collectionUi(right).sort;
    return leftOrder - rightOrder || left.collection.localeCompare(right.collection);
  });
  const columns = ordered.length <= 4 ? 2 : ordered.length <= 9 ? 3 : 4;
  const nodes = ordered.map((collection, index) => ({
    collection,
    x: PADDING + (index % columns) * (NODE_WIDTH + GAP_X),
    y: PADDING + Math.floor(index / columns) * (NODE_HEIGHT + GAP_Y),
  }));
  const nodeIndex = new Map(nodes.map((node) => [node.collection.collection, node]));
  const edgeKeys = new Set();
  const edges = [];

  for (const relation of relations) {
    const from = nodeIndex.get(relation.many_collection);
    const to = nodeIndex.get(relation.one_collection);
    if (!from || !to || from === to) continue;
    const key = `${relation.many_collection}:${relation.many_field}:${relation.one_collection}:${graphRelationKind(relation)}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      key,
      relation,
      kind: graphRelationKind(relation),
      from,
      to,
    });
  }

  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  return {
    nodes,
    edges,
    width: PADDING * 2 + columns * NODE_WIDTH + Math.max(0, columns - 1) * GAP_X,
    height: PADDING * 2 + rows * NODE_HEIGHT + Math.max(0, rows - 1) * GAP_Y,
  };
}

function edgePath(edge) {
  const fromX = edge.from.x + NODE_WIDTH / 2;
  const fromY = edge.from.y + NODE_HEIGHT / 2;
  const toX = edge.to.x + NODE_WIDTH / 2;
  const toY = edge.to.y + NODE_HEIGHT / 2;
  const middleX = (fromX + toX) / 2;
  return `M ${fromX} ${fromY} C ${middleX} ${fromY}, ${middleX} ${toY}, ${toX} ${toY}`;
}

export function SchemaGraph({ collections = [], relations = [], onOpenCollection, labels }) {
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState('');
  const visibleCollections = useMemo(
    () => collections.filter((collection) => showSystem || !collection.system),
    [collections, showSystem],
  );
  const graph = useMemo(
    () => buildGraphModel(visibleCollections, relations),
    [relations, visibleCollections],
  );
  const selectedNode = graph.nodes.find((node) => node.collection.collection === selected) ?? null;
  const connectedNames = useMemo(() => {
    if (!selected) return new Set();
    const names = new Set([selected]);
    for (const edge of graph.edges) {
      if (edge.from.collection.collection === selected) names.add(edge.to.collection.collection);
      if (edge.to.collection.collection === selected) names.add(edge.from.collection.collection);
    }
    return names;
  }, [graph.edges, selected]);
  const selectedRelations = selected
    ? graph.edges.filter((edge) => edge.from.collection.collection === selected || edge.to.collection.collection === selected)
    : [];

  return (
    <section className="schema-graph-workspace" aria-label={labels.title}>
      <header className="schema-graph-toolbar">
        <div>
          <h2>{labels.title}</h2>
          <p>{labels.description}</p>
        </div>
        <label className="schema-graph-system-toggle">
          <input type="checkbox" checked={showSystem} onChange={(event) => setShowSystem(event.target.checked)} />
          <span>{labels.showSystem}</span>
        </label>
      </header>

      {graph.nodes.length === 0 ? (
        <div className="inline-info">{labels.empty}</div>
      ) : (
        <div className="schema-graph-layout">
          <div className="schema-graph-scroll">
            <div className="schema-graph-canvas" style={{ width: graph.width, height: graph.height }}>
              <svg className="schema-graph-edges" width={graph.width} height={graph.height} aria-hidden="true">
                {graph.edges.map((edge) => {
                  const related = !selected
                    || edge.from.collection.collection === selected
                    || edge.to.collection.collection === selected;
                  return (
                    <path
                      key={edge.key}
                      className={`schema-graph-edge kind-${edge.kind} ${related ? 'related' : 'dimmed'}`}
                      d={edgePath(edge)}
                    />
                  );
                })}
              </svg>

              {graph.nodes.map((node) => {
                const name = node.collection.collection;
                const active = selected === name;
                const dimmed = Boolean(selected && !connectedNames.has(name));
                return (
                  <button
                    key={name}
                    type="button"
                    className={`schema-graph-node ${active ? 'active' : ''} ${dimmed ? 'dimmed' : ''}`}
                    style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                    aria-pressed={active}
                    onClick={() => setSelected((current) => current === name ? '' : name)}
                  >
                    <span className="schema-graph-node-icon"><CollectionIcon name={collectionUi(node.collection).icon} size={17} /></span>
                    <span className="schema-graph-node-copy">
                      <strong>{displaySchemaName(node.collection, 'collection')}</strong>
                      <code>{name}</code>
                    </span>
                    <small>{node.collection.system ? labels.system : node.collection.hidden ? labels.hidden : labels.visible}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="schema-graph-inspector" aria-live="polite">
            {selectedNode ? (
              <>
                <div className="schema-graph-inspector-heading">
                  <span className="schema-graph-node-icon"><CollectionIcon name={collectionUi(selectedNode.collection).icon} size={18} /></span>
                  <div>
                    <strong>{displaySchemaName(selectedNode.collection, 'collection')}</strong>
                    <code>{selectedNode.collection.collection}</code>
                  </div>
                </div>
                <p>{selectedNode.collection.note || labels.noDescription}</p>
                <dl>
                  <div><dt>{labels.relations}</dt><dd>{selectedRelations.length}</dd></div>
                  <div><dt>{labels.visibility}</dt><dd>{selectedNode.collection.hidden ? labels.hidden : labels.visible}</dd></div>
                  <div><dt>{labels.kind}</dt><dd>{selectedNode.collection.system ? labels.system : labels.project}</dd></div>
                </dl>
                <div className="schema-graph-relation-list">
                  {selectedRelations.slice(0, 8).map((edge) => (
                    <div key={edge.key}>
                      <span>{edge.kind.toUpperCase()}</span>
                      <code>{edge.relation.many_collection}.{edge.relation.many_field}</code>
                      <small>→ {edge.relation.one_collection}</small>
                    </div>
                  ))}
                </div>
                <button className="primary-button" type="button" onClick={() => onOpenCollection?.(selectedNode.collection.collection)}>
                  {labels.openCollection}
                </button>
              </>
            ) : (
              <div className="schema-graph-inspector-empty">
                <strong>{labels.inspectorTitle}</strong>
                <p>{labels.inspectorHint}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

export { buildGraphModel, graphRelationKind };
