/**
 * `.env` file parsing.
 *
 * This exists because the documented setup path is "copy .env.example to .env",
 * and that template carries inline comments. A parser that keeps the comment as
 * part of the value turns `HOST=0.0.0.0  # container…` into a hostname that
 * cannot resolve — a failure that looks like a networking bug and is not one.
 *
 * The rules follow the dotenv convention, which is what people already expect:
 *
 *   KEY=value            → `value`                       (trimmed)
 *   KEY=value   # note   → `value`                       (inline comment dropped)
 *   KEY='value # here'   → `value # here`                ('#' inside quotes is data)
 *   KEY="value"  # note  → `value`                       (comment after the quote dropped)
 *   URL=http://h/p#frag  → `http://h/p#frag`             ('#' needs whitespace before it
 *                                                         to start a comment)
 *   # comment            → ignored
 *   export KEY=value     → `value`
 *
 * `\n`, `\r`, `\t`, `\"` and `\\` are unescaped inside double quotes only.
 * Values may contain `=` (base64 padding, for example).
 */

export function parseEnvFileText(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // Quoted: the value ends at the matching quote; anything after it is a
      // comment. An unterminated quote takes the rest of the line rather than
      // throwing, because a malformed .env must never stop the server booting.
      let end = -1;
      for (let i = 1; i < value.length; i += 1) {
        if (quote === '"' && value[i] === '\\') {
          i += 1;
          continue;
        }
        if (value[i] === quote) {
          end = i;
          break;
        }
      }
      value = end === -1 ? value.slice(1) : value.slice(1, end);
      if (quote === '"') value = unescapeDoubleQuoted(value);
    } else {
      // Unquoted: a comment starts at a '#' that follows whitespace, so URL
      // fragments and the like survive.
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment);
      if (value.startsWith('#')) value = '';
      value = value.trim();
    }

    out[key] = value;
  }

  return out;
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_match, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return char;
    }
  });
}

/**
 * Load a `.env` file into `process.env`. Real environment variables always win,
 * so a container or orchestrator can override the file without editing it.
 * Returns the keys that were applied, which makes this testable and loggable.
 */
export function loadEnvFile(
  readFile: (path: string) => string,
  envPath: string,
  target: NodeJS.ProcessEnv = process.env,
): string[] {
  let text: string;
  try {
    text = readFile(envPath);
  } catch {
    return [];
  }

  const parsed = parseEnvFileText(text);
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) {
      target[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
