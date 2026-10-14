import { FLOW_OPERATION_DEFAULTS, triggerDefaults } from '../flow-graph.js';
import { useI18n } from '../i18n.js';
import { JsonField } from './JsonField.jsx';

export function FlowInspector({ flow, selected, configuration, onChange, onRemove, onValidityChange, disabled }) {
  const { t } = useI18n();
  const node = flow.operations.find(item => item.id === selected);
  const patch = update => onChange({ ...flow, ...update });
  const options = update => patch({ options: { ...flow.options, ...update } });
  const patchNode = update => patch({ operations: flow.operations.map(item => item.id === selected ? { ...item, ...update } : item) });
  const selectCollection = (value, onSelect) => <select value={value ?? ''} onChange={event => onSelect(event.target.value)}><option value="">{t('common.none')}</option>
    {configuration.collections.map(collection => <option value={collection.collection} key={collection.collection}>{collection.name}</option>)}</select>;
  if (selected !== 'trigger' && !node) return <aside className="flow-inspector"><p>{t('flow.noSelection')}</p></aside>;
  return <aside className="flow-inspector" aria-label={selected === 'trigger' ? t('flow.triggerLabel') : t('flow.selected')}>
    <fieldset disabled={disabled}>
      {selected === 'trigger' ? <>
        <h2>{t('flow.triggerLabel')}</h2>
        <label className="field-label"><span>{t('common.name')}</span><input required maxLength={120} value={flow.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label className="field-label"><span>{t('flow.description')}</span><textarea maxLength={2000} rows={2} value={flow.description} onChange={event => patch({ description: event.target.value })} /></label>
        <label className="field-label"><span>{t('flow.status')}</span><select aria-label={t('flow.status')} value={flow.status} onChange={event => patch({ status: event.target.value })}>
          <option value="inactive">{t('flow.inactive')}</option><option value="active">{t('flow.active')}</option></select></label>
        <label className="field-label"><span>{t('flow.triggerLabel')}</span><select value={flow.trigger} onChange={event => patch({ trigger: event.target.value, options: triggerDefaults(event.target.value), ...(event.target.value === 'schedule' && flow.accountability === 'trigger' ? { accountability: 'public' } : {}) })}>
          {['manual', 'event', 'webhook', 'schedule', 'operation'].map(type => <option key={type} value={type}>{t(`flow.trigger.${type}`)}</option>)}</select></label>
        <label className="field-label"><span>{t('flow.accountability')}</span><select value={flow.accountability} onChange={event => patch({ accountability: event.target.value, run_as: null })}>
          {['trigger', 'public', 'user', 'system'].filter(value => value !== 'trigger' || flow.trigger !== 'schedule').map(value => <option value={value} key={value}>{t(`flow.accountability.${value}`)}</option>)}</select></label>
        {flow.accountability === 'user' && <label className="field-label"><span>{t('flow.runAs')}</span><select value={flow.run_as ?? ''} onChange={event => patch({ run_as: event.target.value })}><option value="">{t('common.none')}</option>
          {configuration.users.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>}
        {flow.trigger === 'manual' && <>
          <label className="field-label"><span>{t('flow.collection')}</span>{selectCollection(flow.options.collections?.[0], value => options({ collections: value ? [value] : [] }))}</label>
          <label className="field-label"><span>{t('flow.allowedRoles')}</span><select multiple value={flow.options.allowed_roles ?? []} onChange={event => options({ allowed_roles: Array.from(event.target.selectedOptions, option => option.value) })}>
            {configuration.roles.filter(role => !role.public).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label className="checkbox-label"><input type="checkbox" checked={flow.options.require_selection === true} onChange={event => options({ require_selection: event.target.checked })} />{t('flow.requireSelection')}</label>
          <label className="checkbox-label"><input type="checkbox" checked={flow.options.require_confirmation === true} onChange={event => options({ require_confirmation: event.target.checked })} />{t('flow.requireConfirmation')}</label>
        </>}
        {flow.trigger === 'event' && <>
          <label className="field-label"><span>{t('flow.eventMode')}</span><select value={flow.options.mode} onChange={event => options({ mode: event.target.value, events: ['items.create'] })}><option value="action">{t('flow.action')}</option><option value="filter">{t('flow.filter')}</option></select></label>
          <label className="field-label"><span>{t('flow.event')}</span><select value={flow.options.events?.[0] ?? 'items.create'} onChange={event => options({ events: [event.target.value] })}>
            {(flow.options.mode === 'filter' ? configuration.filter_events : configuration.action_events).map(event => <option key={event}>{event}</option>)}</select></label>
          <label className="field-label"><span>{t('flow.collection')}</span>{selectCollection(flow.options.collections?.[0], value => options({ collections: value ? [value] : [] }))}</label>
        </>}
        {flow.trigger === 'schedule' && <label className="field-label"><span>{t('flow.cron')}</span><input value={flow.options.cron ?? ''} onChange={event => options({ cron: event.target.value })} /><small>{t('flow.cronHint')}</small></label>}
        {flow.trigger === 'webhook' && <>
          <label className="field-label"><span>{t('flow.method')}</span><select value={flow.options.method} onChange={event => options({ method: event.target.value })}><option>POST</option><option>GET</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={flow.options.public === true} onChange={event => options({ public: event.target.checked })} />{t('flow.publicWebhook')}</label>
          {flow.id && <label className="field-label"><span>{t('flow.webhookUrl')}</span><input readOnly value={`${window.location.origin}/flows/trigger/${flow.id}`} /></label>}
        </>}
        <label className="field-label"><span>{t('flow.response')}</span><input value={flow.options.response ?? ''} onChange={event => options({ response: event.target.value })} /><small>{t('flow.responseHint')}</small></label>
        <details className="flow-advanced"><summary>{t('flow.triggerOptions')}</summary><JsonField objectOnly key={flow.trigger} label={t('flow.triggerOptions')} value={flow.options} onChange={value => patch({ options: value })} onValidityChange={onValidityChange} errorLabel={t('flow.invalidJson')} /></details>
      </> : <>
        <h2>{t('flow.selected')}</h2>
        <label className="field-label"><span>{t('common.name')}</span><input maxLength={120} value={node.name} onChange={event => patchNode({ name: event.target.value })} /></label>
        <label className="field-label"><span>{t('flow.key')}</span><input maxLength={60} value={node.key} onChange={event => patchNode({ key: event.target.value })} /></label>
        <label className="field-label"><span>{t('flow.type')}</span><select value={node.type} onChange={event => patchNode({ type: event.target.value, options: structuredClone(FLOW_OPERATION_DEFAULTS[event.target.value] ?? {}) })}>
          {configuration.operations.map(type => <option key={type} value={type}>{t(`flow.operation.${type}`)}</option>)}</select></label>
        {['read', 'create', 'update', 'delete'].includes(node.type) && <label className="field-label"><span>{t('flow.collection')}</span>{selectCollection(node.options.collection, collection => patchNode({ options: { ...node.options, collection } }))}</label>}
        <JsonField objectOnly key={`${node.id}:${node.type}`} label={t('flow.options')} value={node.options} onChange={value => patchNode({ options: value })} onValidityChange={onValidityChange} hint={t('flow.jsonHint')} errorLabel={t('flow.invalidJson')} rows={10} />
        <button type="button" className="danger-button" onClick={() => onRemove(node.id)}>{t('flow.removeOperation')}</button>
      </>}
    </fieldset>
  </aside>;
}
