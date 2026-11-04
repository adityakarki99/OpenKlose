/**
 * The parts of the project store that don't touch a filesystem: how ids are
 * checked, where a new sketch lands, what a new project looks like, the demo
 * sketch. Shared by server/store.js (Node, over .klose/projects/ on disk) and
 * lib/folderStore.js (the hosted canvas, over a folder the browser was given),
 * so both write the same records. No imports, so it bundles into the canvas.
 */

// Project ids are always generated UUIDs. Route params and file names reach
// the stores straight from the outside, so anything that isn't a well-formed
// UUID is rejected before it can influence a path.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

export const EMPTY_PROJECT_CONTEXT = {
  projectDescription: '',
  targetAudience: '',
  brandName: '',
  brandVoice: '',
  designReferences: '',
  techNotes: '',
  productInfo: '',
};

/** A new, empty project record. */
export function newProject(id, name = 'Untitled Project', now = new Date().toISOString()) {
  return {
    id,
    name,
    description: '',
    nodes: [],
    designSystemPrompt: '',
    projectContext: { ...EMPTY_PROJECT_CONTEXT },
    created_at: now,
    updated_at: now,
  };
}

/**
 * The timestamp an edit stamps on a project. Always later than the one it
 * replaces, even when two writes land in the same millisecond, so "has this
 * changed since?" comparisons can trust it.
 */
export function nextUpdatedAt(previous, now = Date.now()) {
  const before = Date.parse(previous);
  return new Date(Number.isFinite(before) && before >= now ? before + 1 : now).toISOString();
}

// Where a sketch lands when whoever adds it (usually the agent) doesn't say:
// in a row to the right of the existing ones, top-aligned with them.
const DEFAULT_NODE = { width: 480, height: 360 };
const NODE_GAP = 80;
const FIRST_NODE_AT = { x: 200, y: 160 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function placeNode(existing, node) {
  const width = isNum(node.width) ? node.width : DEFAULT_NODE.width;
  const height = isNum(node.height) ? node.height : DEFAULT_NODE.height;
  if (isNum(node.x) && isNum(node.y)) return { x: node.x, y: node.y, width, height };
  const placed = existing.filter((n) => isNum(n.x) && isNum(n.y));
  if (!placed.length) return { ...FIRST_NODE_AT, width, height };
  const right = Math.max(...placed.map((n) => n.x + (isNum(n.width) ? n.width : DEFAULT_NODE.width)));
  const top = Math.min(...placed.map((n) => n.y));
  return { x: right + NODE_GAP, y: top, width, height };
}

/** The summary of a project that listings carry (no context, no design notes). */
export function projectSummary({ id, name, description, nodes, created_at, updated_at, savedToRepo }) {
  return {
    id,
    name,
    description,
    nodes,
    created_at,
    updated_at,
    ...(savedToRepo ? { savedToRepo } : {}),
  };
}

/** Pending feedback in a stable, agent-friendly shape, from projects already read. */
export function feedbackOf(projects, { includeResolved = false } = {}) {
  return projects.flatMap((project) =>
    (project.nodes || []).flatMap((node) =>
      (node.comments || [])
        .filter((comment) => includeResolved || !comment.resolvedAt)
        .map((comment) => ({
          projectId: project.id,
          projectName: project.name,
          nodeId: node.id,
          nodeName: node.name,
          builtFilePath: node.builtFilePath || null,
          commentId: comment.id,
          text: comment.text,
          createdAt: comment.createdAt,
          element: comment.element || null,
          status: comment.resolvedAt ? 'resolved' : comment.sentAt ? 'sent' : 'new',
          ...(comment.resolvedAt ? { resolvedAt: comment.resolvedAt, resolution: comment.resolution || null } : {}),
          ...(comment.triage
            ? {
                triage: {
                  kind: comment.triage.kind,
                  effort: comment.triage.effort,
                  kindConfidence: comment.triage.kindConfidence ?? null,
                  effortConfidence: comment.triage.effortConfidence ?? null,
                },
              }
            : {}),
        }))
    )
  );
}

export const DEMO_PROJECT_NAME = 'Klose demo';

export const DEMO_SKETCH_CODE = `export default function WelcomeCard() {
  return (
    <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
        <span>✦</span> Klose demo sketch
      </div>
      <h2 className="text-lg font-semibold text-slate-900">This is a sketch</h2>
      <p className="mt-2 text-sm text-slate-600">
        A live-rendered preview, not a labeled box. Leave a comment below, or click an element in
        the preview to scope feedback to it — then ask your agent to address it.
      </p>
      <button className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
        Ask your agent to build this
      </button>
    </div>
  );
}
`;

/** The sketch `klose init` (and "Try an example") puts on an empty canvas. */
export const DEMO_NODE = {
  name: 'Welcome to Klose',
  description: 'A live-rendered preview, not a static mockup — this is what a sketch looks like.',
  notes:
    "Created by `klose init` so the canvas isn't empty on first run. Leave a comment on it (or " +
    'click an element in the preview) to see feedback flow back to your agent, then ask it to ' +
    'build something real for your project — that replaces this note with actual work.',
  code: DEMO_SKETCH_CODE,
};

/** What `.klose/.gitignore` lists: the per-machine files Klose writes next to the projects. */
export const KLOSE_GITIGNORE = ['server.json', 'server.log', 'canvas.json', 'shares/'];

// ── Live frame cards ────────────────────────────────────────────────────────

/** Largest `snapshot` (a PNG data URL) a card may carry, in characters. */
export const MAX_SNAPSHOT_CHARS = 2 * 1024 * 1024;

/**
 * Whether `url` may be drawn as a live frame: an http(s) address on this
 * machine (`localhost`, `127.0.0.1`, `[::1]` or `*.localhost`, any port), with
 * no credentials. Everything else — other hosts, `file:`, `javascript:`,
 * `data:` — is refused. Checked when a card is saved (every store) and again
 * when it is drawn, so a hand-edited project file can't smuggle one in.
 */
export function isAllowedLiveUrl(url) {
  if (typeof url !== 'string' || url !== url.trim() || !url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/**
 * What is wrong with a card's `url` / `snapshot`, or null when they're fine.
 * Only the fields present are checked, so an update that touches neither passes.
 */
export function liveNodeProblem(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.url !== undefined && node.url !== null && !isAllowedLiveUrl(node.url)) {
    return `Live card url must be http(s) on localhost, 127.0.0.1, [::1] or *.localhost, with no credentials: ${JSON.stringify(node.url)}`;
  }
  if (node.snapshot !== undefined && node.snapshot !== null) {
    if (typeof node.snapshot !== 'string' || !node.snapshot.startsWith('data:image/png;base64,')) {
      return 'snapshot must be a PNG data URL (data:image/png;base64,…)';
    }
    if (node.snapshot.length > MAX_SNAPSHOT_CHARS) {
      return `snapshot is larger than the ${MAX_SNAPSHOT_CHARS / (1024 * 1024)} MB limit`;
    }
  }
  return null;
}
