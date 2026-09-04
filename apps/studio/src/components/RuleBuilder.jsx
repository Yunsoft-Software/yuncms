import { useMemo, useState } from 'react';

const OPERATORS = Object.freeze([
  '_eq',
  '_neq',
  '_contains',
  '_starts_with',
  '_ends_with',
  '_gt',
  '_gte',
  '_lt',
  '_lte',
  '_null',
  '_nnull',
]);

function simpleClauseFromObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.keys(value);
  if (fields.length !== 1) return null;
  const field = fields[0];
  const condition = value[field];
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null;
  const operators = Object.keys(condition);
  if (operators.length !== 1 || !OPERATORS.includes(operators[0])) return null;
  const operator = operators[0];
  return { field, operator, value: condition[operator] };
}

export function parseSimpleRules(jsonValue) {
  const source = String(jsonValue || '').trim();
  if (!source) return { compatible: true, rules: [], error: '' };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { compatible: false, rules: [], error: error.message || 'Invalid JSON' };
  }
  if (parsed == null) return { compatible: true, rules: [], error: '' };

  const clauses = parsed?._and;
  if (Array.isArray(clauses) && Object.keys(parsed).length === 1) {
    const rules = clauses.map(simpleClauseFromObject);
    if (rules.every(Boolean)) return { compatible: true, rules, error: '' };
    return { compatible: false, rules: [], error: '' };
  }

  const single = simpleClauseFromObject(parsed);
  if (single) return { compatible: true, rules: [single], error: '' };
  return { compatible: false, rules: [], error: '' };
}

function fieldType(fields, fieldName) {
  return fields.find((field) => field.field === fieldName)?.type || 'string';
}

function normalizeRuleValue(type, operator, value) {
  if (operator === '_null' || operator === '_nnull') return true;
  if (type === 'boolean') return value === true || value === 'true';
  if (['integer', 'bigint'].includes(type)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'decimal') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

export function rulesToFilter(rules, fields = []) {
  const clauses = rules
    .filter((rule) => rule.field && rule.operator)
    .map((rule) => ({
      [rule.field]: {
        [rule.operator]: normalizeRuleValue(fieldType(fields, rule.field), rule.operator, rule.value),
      },
    }));
  if (clauses.length === 0) return '';
  const filter = clauses.length === 1 ? clauses[0] : { _and: clauses };
  return JSON.stringify(filter, null, 2);
}

function inputType(type) {
  if (['integer', 'bigint', 'decimal'].includes(type)) return 'number';
  if (type === 'date') return 'date';
  if (['datetime', 'timestamp'].includes(type)) return 'datetime-local';
  return 'text';
}

export function RuleBuilder({
  value = '',
  fields = [],
  disabled = false,
  onChange,
  labels = {},
}) {
  const parsed = useMemo(() => parseSimpleRules(value), [value]);
  const [rawOpen, setRawOpen] = useState(false);
  const rules = parsed.compatible ? parsed.rules : [];

  function commit(nextRules) {
    onChange?.(rulesToFilter(nextRules, fields));
  }

  function updateRule(index, patch) {
    const next = rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule);
    commit(next);
  }

  function addRule() {
    const firstField = fields[0]?.field || '';
    commit([...rules, { field: firstField, operator: '_eq', value: '' }]);
  }

  function removeRule(index) {
    commit(rules.filter((_, ruleIndex) => ruleIndex !== index));
  }

  const forceRaw = !parsed.compatible;
  const showRaw = forceRaw || rawOpen;

  return (
    <div className={`rule-builder ${forceRaw ? 'raw-only' : ''}`}>
      <div className="rule-builder-heading">
        <div>
          <strong>{labels.title || 'Rules'}</strong>
          {labels.description && <p>{labels.description}</p>}
        </div>
        {!forceRaw && (
          <button className="text-button" type="button" onClick={() => setRawOpen((current) => !current)}>
            {rawOpen ? (labels.visualMode || 'Visual editor') : (labels.rawMode || 'Advanced JSON')}
          </button>
        )}
      </div>

      {forceRaw && (
        <div className="inline-info rule-builder-raw-notice">
          {parsed.error ? (labels.invalidJson || 'Invalid JSON') : (labels.complexJson || 'This rule uses advanced JSON and is preserved as-is.')}
        </div>
      )}

      {!showRaw && (
        <div className="rule-builder-visual">
          {rules.map((rule, index) => {
            const type = fieldType(fields, rule.field);
            const noValue = rule.operator === '_null' || rule.operator === '_nnull';
            return (
              <div className="rule-builder-row" key={`${index}-${rule.field}-${rule.operator}`}>
                <select
                  value={rule.field}
                  disabled={disabled}
                  aria-label={labels.field || 'Field'}
                  onChange={(event) => updateRule(index, { field: event.target.value, value: '' })}
                >
                  {fields.map((field) => (
                    <option key={field.field} value={field.field}>{field.name || field.field}</option>
                  ))}
                </select>
                <select
                  value={rule.operator}
                  disabled={disabled}
                  aria-label={labels.operator || 'Condition'}
                  onChange={(event) => updateRule(index, { operator: event.target.value, value: '' })}
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>{labels.operators?.[operator] || operator}</option>
                  ))}
                </select>
                {noValue ? (
                  <span className="rule-builder-no-value">{labels.noValue || 'No value'}</span>
                ) : type === 'boolean' ? (
                  <select
                    value={String(rule.value ?? '')}
                    disabled={disabled}
                    aria-label={labels.value || 'Value'}
                    onChange={(event) => updateRule(index, { value: event.target.value })}
                  >
                    <option value="">—</option>
                    <option value="true">{labels.trueLabel || 'True'}</option>
                    <option value="false">{labels.falseLabel || 'False'}</option>
                  </select>
                ) : (
                  <input
                    type={inputType(type)}
                    step={type === 'decimal' ? 'any' : undefined}
                    value={rule.value === true ? '' : (rule.value ?? '')}
                    disabled={disabled}
                    aria-label={labels.value || 'Value'}
                    onChange={(event) => updateRule(index, { value: event.target.value })}
                  />
                )}
                <button
                  className="text-button rule-builder-remove"
                  type="button"
                  disabled={disabled}
                  aria-label={labels.removeRule || 'Remove rule'}
                  onClick={() => removeRule(index)}
                >
                  ×
                </button>
              </div>
            );
          })}
          {rules.length === 0 && <p className="rule-builder-empty">{labels.empty || 'No restrictions.'}</p>}
          <button className="secondary-button rule-builder-add" type="button" disabled={disabled || fields.length === 0} onClick={addRule}>
            {labels.addRule || 'Add rule'}
          </button>
        </div>
      )}

      {showRaw && (
        <label className="field-label rule-builder-raw">
          <span>{labels.rawLabel || 'JSON'}</span>
          <textarea
            rows="9"
            value={value}
            disabled={disabled}
            spellCheck="false"
            onChange={(event) => onChange?.(event.target.value)}
            placeholder={labels.placeholder || '{"status":{"_eq":"active"}}'}
          />
        </label>
      )}
    </div>
  );
}

export { OPERATORS as RULE_OPERATORS };
