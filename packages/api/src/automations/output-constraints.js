const TEXT_TYPES = new Set(['string', 'text']);
const MAX_SCHEMA_BYTES = 50_000;

function constraintError(code, field, message) {
  return Object.assign(new Error(message), { code, path: field });
}

export function normalizeOutputConstraints(value, inputs, outputs) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw constraintError('INVALID_AUTOMATION', 'output_constraints', 'Output constraints must be a field mapping');
  }
  const entries = Object.entries(value);
  if (entries.length > 10) throw constraintError('INVALID_AUTOMATION', 'output_constraints', 'At most ten output constraints are allowed');
  return Object.fromEntries(entries.map(([field, binding]) => {
    if (!outputs.includes(field) || !binding || typeof binding !== 'object' || Array.isArray(binding)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(binding))
      || Object.keys(binding).length !== 1 || !Object.hasOwn(binding, 'must_equal_input')
      || typeof binding.must_equal_input !== 'string' || !inputs.includes(binding.must_equal_input)) {
      throw constraintError('INVALID_AUTOMATION', field, 'An output constraint must reference a configured input field');
    }
    return [field, { must_equal_input: binding.must_equal_input }];
  }));
}

export function validateConstraintDefinitions(rule, collection) {
  const bindings = normalizeOutputConstraints(rule.output_constraints, rule.input_fields, rule.output_fields);
  if (!Object.keys(bindings).length) return bindings;
  for (const [field, binding] of Object.entries(bindings)) {
    if (!TEXT_TYPES.has(collection.fields[field]?.type)
      || !TEXT_TYPES.has(collection.fields[binding.must_equal_input]?.type)) {
      throw constraintError('INVALID_AUTOMATION', field, 'Exact input equality requires string or text fields');
    }
  }
  if (rule.output_fields.some(field => collection.fields[field]?.type === 'json')) {
    throw constraintError('INVALID_AUTOMATION', 'output_constraints', 'Constrained rules support scalar outputs; separate JSON outputs into another rule');
  }
  return bindings;
}

function propertySchema(field) {
  const types = field.type === 'boolean' ? ['boolean']
    : field.type === 'integer' ? ['integer']
      : field.type === 'decimal' ? ['number', 'string'] : ['string'];
  if (!field.required) types.push('null');
  return { type: types.length === 1 ? types[0] : types };
}

export function buildOutputContract(rule, input, collection) {
  const bindings = validateConstraintDefinitions(rule, collection);
  if (!Object.keys(bindings).length) return { schema: null, expected: {} };
  const expected = Object.fromEntries(Object.entries(bindings).map(([field, binding]) => {
    const value = input[binding.must_equal_input];
    if (!Object.hasOwn(input, binding.must_equal_input)
      || (typeof value !== 'string' && value !== null)
      || (value === null && collection.fields[field].required)) {
      throw constraintError('AI_OUTPUT_CONSTRAINT_INPUT_INVALID', field, 'The input value cannot satisfy the configured output constraint');
    }
    return [field, value];
  }));
  const schema = { type: 'object', properties: Object.fromEntries(rule.output_fields.map(field => [field, {
    ...propertySchema(collection.fields[field]),
    ...(Object.hasOwn(expected, field) ? { enum: [expected[field]] } : {}),
  }])), required: [...rule.output_fields], additionalProperties: false };
  if (Buffer.byteLength(JSON.stringify(schema), 'utf8') > MAX_SCHEMA_BYTES) {
    throw constraintError('AI_OUTPUT_CONSTRAINT_INPUT_INVALID', 'output_constraints', 'The generated output constraint exceeds the supported size');
  }
  return { schema, expected: Object.freeze(expected) };
}

export function enforceOutputConstraints(output, expected, bindings = null) {
  for (const [field, value] of Object.entries(expected)) {
    const input = bindings?.[field]?.must_equal_input;
    if (!output || !Object.hasOwn(output, field) || output[field] !== value
      || (bindings && (!input || !Object.hasOwn(output, input) || output[input] !== value))) {
      throw constraintError('AI_OUTPUT_CONSTRAINT_FAILED', field, 'Generated output does not match its configured input field');
    }
  }
  return output;
}
