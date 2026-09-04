export function RelationDiagram({
  kind = 'm2o',
  leftCollection = '',
  leftField = '',
  rightCollection = '',
  junctionCollection = '',
  onDelete = '',
  labels = {},
}) {
  const manyToMany = kind === 'm2m';
  const leftRole = manyToMany ? (labels.collection || 'Collection') : (kind === 'o2o' ? (labels.one || 'One') : (labels.many || 'Many'));
  const rightRole = kind === 'm2o' ? (labels.one || 'One') : (labels.one || 'One');
  const connector = manyToMany ? '↔' : '→';
  const result = manyToMany
    ? junctionCollection || labels.junctionPending || 'junction'
    : leftField && leftCollection
      ? `${leftCollection}.${leftField}`
      : labels.fieldPending || 'field';

  return (
    <section className="relation-diagram" aria-label={labels.preview || 'Relation preview'}>
      <div className="relation-diagram-heading">
        <strong>{labels.preview || 'Relation preview'}</strong>
        <span className="status-pill">{kind.toUpperCase()}</span>
      </div>
      <div className="relation-diagram-canvas">
        <article className={`relation-diagram-node ${leftCollection ? 'ready' : ''}`}>
          <small>{leftRole}</small>
          <strong>{leftCollection || labels.chooseCollection || 'Choose collection'}</strong>
          {!manyToMany && <code>{leftField || labels.chooseField || 'choose_field'}</code>}
        </article>
        <div className="relation-diagram-connector" aria-hidden="true">
          <span>{connector}</span>
          {manyToMany && <code>{junctionCollection || labels.junctionPending || 'junction'}</code>}
        </div>
        <article className={`relation-diagram-node ${rightCollection ? 'ready' : ''}`}>
          <small>{rightRole}</small>
          <strong>{rightCollection || labels.chooseCollection || 'Choose collection'}</strong>
          <code>{manyToMany ? labels.related || 'related' : 'id'}</code>
        </article>
      </div>
      <dl className="relation-diagram-meta">
        <div><dt>{labels.result || 'Result'}</dt><dd><code>{result}</code></dd></div>
        {!manyToMany && <div><dt>{labels.onDelete || 'On delete'}</dt><dd>{onDelete || 'RESTRICT'}</dd></div>}
      </dl>
    </section>
  );
}
