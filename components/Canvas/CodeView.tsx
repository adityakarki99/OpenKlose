import React, { useMemo, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface CodeViewProps {
  /** The sketch's preview source — the exact code the sandbox iframe renders. */
  code: string;
  /** Which export of `code` is being rendered, when the agent named one. */
  exportName?: string;
  /** Path of the real file, once the sketch has been built into the repo. */
  filePath?: string;
  onClose: () => void;
}

type TokenKind = 'comment' | 'string' | 'keyword' | 'number' | 'tag' | 'plain';

/**
 * Deliberately small TSX highlighter: enough to read a sketch at a glance,
 * with no parser dependency to ship. Ambiguous cases (regex literals, JSX text
 * that looks like a keyword) just render as plain text.
 */
const TOKEN_PATTERN = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // comments
    '(`(?:\\\\[\\s\\S]|[^`\\\\])*`|\'(?:\\\\[\\s\\S]|[^\'\\\\\\n])*\'|"(?:\\\\[\\s\\S]|[^"\\\\\\n])*")', // strings
    '(<\\/?[A-Za-z][\\w.]*)', // JSX tags
    '\\b(import|from|export|default|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|delete|typeof|instanceof|interface|type|enum|extends|implements|async|await|class|try|catch|finally|throw|of|in|as|void|null|undefined|true|false|this)\\b', // keywords
    '\\b(\\d[\\w.]*)\\b', // numbers
  ].join('|'),
  'g'
);

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: 'text-emerald-500/70 italic',
  string: 'text-amber-300',
  keyword: 'text-violet-300',
  number: 'text-orange-300',
  tag: 'text-sky-300',
  plain: '',
};

function tokenize(code: string): { text: string; kind: TokenKind }[] {
  const tokens: { text: string; kind: TokenKind }[] = [];
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(code);
  while (match) {
    if (match.index > lastIndex) tokens.push({ text: code.slice(lastIndex, match.index), kind: 'plain' });
    const kind: TokenKind = match[1]
      ? 'comment'
      : match[2]
        ? 'string'
        : match[3]
          ? 'tag'
          : match[4]
            ? 'keyword'
            : 'number';
    tokens.push({ text: match[0], kind });
    lastIndex = match.index + match[0].length;
    match = TOKEN_PATTERN.exec(code);
  }
  if (lastIndex < code.length) tokens.push({ text: code.slice(lastIndex), kind: 'plain' });
  return tokens;
}

/**
 * Shows the source behind a sketch's live preview. It sits on top of the
 * preview rather than replacing it, so the iframe keeps its state (and stays
 * available for a screenshot) while the code is open.
 */
const CodeView: React.FC<CodeViewProps> = ({ code, exportName, filePath, onClose }) => {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => tokenize(code), [code]);
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
    }
  };

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col bg-app-surface"
      // The code panel is a reading surface: clicks inside it must not start a
      // node drag or bubble out to the canvas.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-app-border bg-app-surfaceSoft/60 px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-wider text-app-subtle">
          {filePath || (exportName ? `export ${exportName}` : 'preview source')}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary"
            aria-label="Copy preview code"
          >
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-app-subtle hover:bg-app-surfaceMuted/10 hover:text-app-primary"
            aria-label="Back to preview"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="canvas-scroll flex-1 overflow-auto">
        <div className="flex min-h-full min-w-full">
          <div
            aria-hidden
            className="sticky left-0 select-none border-r border-app-border bg-app-surface px-2 py-2 text-right font-mono text-[11px] leading-[1.5] text-app-subtle/60"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre className="flex-1 px-3 py-2 font-mono text-[11px] leading-[1.5] text-app-secondary">
            <code>
              {tokens.map((token, i) => (
                <span key={i} className={TOKEN_CLASS[token.kind]}>
                  {token.text}
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
};

export default CodeView;
