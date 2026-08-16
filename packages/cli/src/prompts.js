import { createInterface } from 'node:readline/promises';

export async function promptLine(message, {
  defaultValue = null,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const suffix = defaultValue == null ? ': ' : ` [${defaultValue}]: `;
  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(`${message}${suffix}`);
    const trimmed = answer.trim();
    return trimmed === '' && defaultValue != null ? String(defaultValue) : trimmed;
  } finally {
    readline.close();
  }
}

export async function promptSecret(message, {
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    const error = new Error('Secret prompts require an interactive TTY');
    error.code = 'INTERACTIVE_TTY_REQUIRED';
    throw error;
  }

  output.write(`${message}: `);
  const previousRaw = input.isRaw === true;
  const wasPaused = typeof input.isPaused === 'function' ? input.isPaused() : false;
  const previousEncoding = input.readableEncoding ?? null;

  return new Promise((resolve, reject) => {
    let value = '';
    let finished = false;

    function cleanup() {
      input.off('data', onData);
      input.setRawMode(previousRaw);
      if (previousEncoding) input.setEncoding(previousEncoding);
      if (wasPaused) input.pause();
    }

    function finish(error = null) {
      if (finished) return;
      finished = true;
      cleanup();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          const error = new Error('Prompt cancelled');
          error.code = 'PROMPT_CANCELLED';
          finish(error);
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          value += character;
          output.write('*');
        }
      }
    }

    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    input.once('error', finish);
  });
}

export function createInteractivePrompts(options = {}) {
  return {
    line: (message, promptOptions = {}) => promptLine(message, { ...options, ...promptOptions }),
    secret: (message, promptOptions = {}) => promptSecret(message, { ...options, ...promptOptions }),
  };
}
