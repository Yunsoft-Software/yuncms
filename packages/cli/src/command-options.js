function argumentError(message) {
  const error = new Error(message);
  error.code = 'INVALID_CLI_ARGUMENTS';
  return error;
}

export function parseCommandOptions(args = [], {
  boolean = [],
  string = [],
  minPositionals = 0,
  maxPositionals = 0,
} = {}) {
  const booleanOptions = new Set(boolean);
  const stringOptions = new Set(string);
  const values = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const separator = token.indexOf('=');
    const name = separator === -1 ? token : token.slice(0, separator);
    const inlineValue = separator === -1 ? null : token.slice(separator + 1);

    if (booleanOptions.has(name)) {
      if (inlineValue !== null) throw argumentError(`${name} does not accept a value`);
      if (Object.hasOwn(values, name)) throw argumentError(`Duplicate option: ${name}`);
      values[name] = true;
      continue;
    }

    if (stringOptions.has(name)) {
      if (Object.hasOwn(values, name)) throw argumentError(`Duplicate option: ${name}`);
      const value = inlineValue ?? args[++index];
      if (value == null || value === '' || value.startsWith('--')) {
        throw argumentError(`${name} requires a value`);
      }
      values[name] = value;
      continue;
    }

    throw argumentError(`Unknown option: ${name}`);
  }

  if (positionals.length < minPositionals || positionals.length > maxPositionals) {
    const range = minPositionals === maxPositionals
      ? `${minPositionals}`
      : `${minPositionals}-${maxPositionals}`;
    throw argumentError(`Expected ${range} positional arguments, received ${positionals.length}`);
  }

  return { values, positionals };
}
