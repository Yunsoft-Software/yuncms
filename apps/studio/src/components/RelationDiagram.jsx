import { useI18n } from '../i18n.js';

export function RelationDiagram({
  kind = 'm2o',
  leftCollection = '',
  leftField = '',
  rightCollection = '',
  junctionCollection = '',
  onDelete = '',
  labels = {},
}) {
  const { t } = useI18n();
  const manyToMany = kind === 'm2m';
  const collectionLabel = labels.collection || t('dataModel.relationCollectionRole');
  const oneLabel = labels.one || t('dataModel.relationOne');
  const manyLabel = labels.many || t('dataModel.relationMany');
  const previewLabel = labels.preview || t('dataModel.relationPreview');
  const junctionPending = labels.junctionPending || t('dataModel.relationJunctionPending');
  const fieldPending = labels.fieldPending || t('dataModel.relationFieldPending');
  const chooseCollectionLabel = labels.chooseCollection || t('dataModel.chooseCollection');
  const chooseFieldLabel = labels.chooseField || t('dataModel.chooseField');
  const relatedLabel = labels.related || t('dataModel.relationRelated');
  const resultLabel = labels.result || t('dataModel.relationResult');
  const onDeleteLabel = labels.onDelete || t('dataModel.ifTargetDeleted');
  const leftRole = manyToMany ? collectionLabel : (kind === 'o2o' ? oneLabel : manyLabel);
  const rightRole = oneLabel;
  const connector = manyToMany ? '↔' : '→';
  const result = manyToMany
    ? junctionCollection || junctionPending
    : leftField && leftCollection
      ? `${leftCollection}.${leftField}`
      : fieldPending;

  return (
    <section className="relation-diagram" aria-label={previewLabel}>
      <div className="relation-diagram-heading">
        <strong>{previewLabel}</strong>
        <span className="status-pill">{kind.toUpperCase()}</span>
      </div>
      <div className="relation-diagram-canvas">
        <article className={`relation-diagram-node ${leftCollection ? 'ready' : ''}`}>
          <small>{leftRole}</small>
          <strong>{leftCollection || chooseCollectionLabel}</strong>
          {!manyToMany && <code>{leftField || chooseFieldLabel}</code>}
        </article>
        <div className="relation-diagram-connector" aria-hidden="true">
          <span>{connector}</span>
          {manyToMany && <code>{junctionCollection || junctionPending}</code>}
        </div>
        <article className={`relation-diagram-node ${rightCollection ? 'ready' : ''}`}>
          <small>{rightRole}</small>
          <strong>{rightCollection || chooseCollectionLabel}</strong>
          <code>{manyToMany ? relatedLabel : 'id'}</code>
        </article>
      </div>
      <dl className="relation-diagram-meta">
        <div><dt>{resultLabel}</dt><dd><code>{result}</code></dd></div>
        {!manyToMany && <div><dt>{onDeleteLabel}</dt><dd>{onDelete || 'RESTRICT'}</dd></div>}
      </dl>
    </section>
  );
}
