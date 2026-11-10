/**
 * Flows: a user flow laid out as one project, a frame per step and state, that
 * the user approves frame by frame before anything is built (`klose flow`).
 *
 * A flow frame is an ordinary sketch carrying `step` (1-based position in the
 * flow) and `state` ("default", "loading", "error", …). Steps run left to
 * right, a step's states stack top to bottom. `approval` is the user's verdict
 * on a frame; the stores drop it when the frame's code changes (settleApproval
 * in storeCore.js), so "approved" always means "approved as it looks now".
 *
 * Pure: no filesystem, so the canvas can import it too.
 */
import { DEFAULT_NODE, FIRST_NODE_AT, MAX_STATE_CHARS, NODE_GAP } from './storeCore.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isText = (v) => typeof v === 'string' && !!v.trim();
const optionalText = (v) => v === undefined || v === null || typeof v === 'string';

export const MAX_FLOW_STEPS = 40;
export const MAX_STEP_STATES = 12;
const MIN_FRAME = 120;
const MAX_FRAME = 4000;

/**
 * Every problem with a flow plan, as a list of messages (empty when it is
 * fine). The plan:
 *   { description?, steps: [{ name, description?, states: [{ state, name?, description?, notes?, code, width?, height? }] }] }
 */
export function planProblems(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['the plan must be a JSON object: { description, steps: [...] }'];
  const problems = [];
  if (!optionalText(plan.description)) problems.push('description must be a string');
  if (!Array.isArray(plan.steps) || !plan.steps.length) {
    problems.push('steps must be a non-empty list');
    return problems;
  }
  if (plan.steps.length > MAX_FLOW_STEPS) problems.push(`a flow has at most ${MAX_FLOW_STEPS} steps (this one has ${plan.steps.length})`);
  plan.steps.forEach((step, i) => {
    const at = `steps[${i}]`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) return problems.push(`${at} must be an object: { name, states: [...] }`);
    if (!isText(step.name)) problems.push(`${at}.name is required`);
    if (!optionalText(step.description)) problems.push(`${at}.description must be a string`);
    if (!Array.isArray(step.states) || !step.states.length) return problems.push(`${at}.states must be a non-empty list (every step has at least its "default" state)`);
    if (step.states.length > MAX_STEP_STATES) problems.push(`${at} has ${step.states.length} states; the most is ${MAX_STEP_STATES}`);
    const seen = new Set();
    step.states.forEach((s, j) => {
      const here = `${at}.states[${j}]`;
      if (!s || typeof s !== 'object' || Array.isArray(s)) return problems.push(`${here} must be an object: { state, code }`);
      if (!isText(s.state) || s.state !== s.state.trim() || s.state.length > MAX_STATE_CHARS || /[\r\n]/.test(s.state)) {
        problems.push(`${here}.state must be a short one-line label (up to ${MAX_STATE_CHARS} characters), e.g. "default", "loading", "error"`);
      } else if (seen.has(s.state.toLowerCase())) {
        problems.push(`${here}.state "${s.state}" is listed twice in this step`);
      } else {
        seen.add(s.state.toLowerCase());
      }
      if (!isText(s.code)) problems.push(`${here}.code is required (the preview code for this state)`);
      for (const key of ['name', 'description', 'notes']) {
        if (!optionalText(s[key])) problems.push(`${here}.${key} must be a string`);
      }
      for (const key of ['width', 'height']) {
        if (s[key] !== undefined && s[key] !== null && (!isNum(s[key]) || s[key] < MIN_FRAME || s[key] > MAX_FRAME)) {
          problems.push(`${here}.${key} must be a number from ${MIN_FRAME} to ${MAX_FRAME}`);
        }
      }
    });
  });
  return problems;
}

/**
 * The sketches of a valid plan, placed: one column per step (as wide as its
 * widest state), states stacked in the order given. `newId` makes each id.
 */
export function planNodes(plan, { newId, now = Date.now() }) {
  const nodes = [];
  let x = FIRST_NODE_AT.x;
  plan.steps.forEach((step, i) => {
    let y = FIRST_NODE_AT.y;
    let columnWidth = 0;
    for (const s of step.states) {
      const width = isNum(s.width) ? s.width : DEFAULT_NODE.width;
      const height = isNum(s.height) ? s.height : DEFAULT_NODE.height;
      nodes.push({
        id: newId(),
        name: isText(s.name) ? s.name.trim() : `${step.name.trim()} · ${s.state}`,
        description: (isText(s.description) ? s.description : step.description || '').trim(),
        ...(isText(s.notes) ? { notes: s.notes } : {}),
        status: 'sketch',
        step: i + 1,
        state: s.state,
        code: s.code,
        x,
        y,
        width,
        height,
        createdAt: now,
        updatedAt: now,
      });
      y += height + NODE_GAP;
      columnWidth = Math.max(columnWidth, width);
    }
    x += columnWidth + NODE_GAP;
  });
  return nodes;
}

/** True for a frame that belongs to a flow. */
export const isFlowNode = (node) => Number.isInteger(node?.step) && node.step >= 1;

const openCount = (node) => (node.comments || []).filter((c) => !c.resolvedAt).length;

/** Why a flow frame can't be built yet, or null when it is ready (or already built). */
function blockedReason(frame) {
  if (frame.status === 'built') return null;
  if (frame.pendingComments) return `${frame.pendingComments} open comment${frame.pendingComments === 1 ? '' : 's'}`;
  if (frame.approval === 'changes') return 'changes requested';
  if (frame.approval !== 'approved') return 'not approved yet';
  return null;
}

/**
 * Where a flow stands: its frames by step and state, what is ready to build
 * (approved, not built, no open comments) and what is blocked, with the reason.
 */
export function flowStatus(project) {
  const frames = (project.nodes || [])
    .filter(isFlowNode)
    .map((n) => ({
      nodeId: n.id,
      name: n.name,
      step: n.step,
      state: n.state || 'default',
      approval: n.approval?.status || null,
      ...(n.approval ? { approvalAt: n.approval.at } : {}),
      pendingComments: openCount(n),
      status: n.status === 'built' ? 'built' : 'sketch',
      builtFilePath: n.builtFilePath || null,
      y: isNum(n.y) ? n.y : 0,
    }))
    .sort((a, b) => a.step - b.step || a.y - b.y)
    .map(({ y: _y, ...frame }) => frame);

  const steps = [];
  for (const frame of frames) {
    let step = steps[steps.length - 1];
    if (!step || step.step !== frame.step) {
      step = { step: frame.step, states: [] };
      steps.push(step);
    }
    step.states.push(frame);
  }
  for (const step of steps) step.built = step.states.every((f) => f.status === 'built');

  const brief = ({ nodeId, name, step, state }) => ({ nodeId, name, step, state });
  const ready = frames.filter((f) => f.status !== 'built' && !blockedReason(f)).map(brief);
  const blocked = frames.flatMap((f) => {
    const reason = blockedReason(f);
    return reason ? [{ ...brief(f), reason }] : [];
  });
  const built = frames.filter((f) => f.status === 'built').length;
  return {
    projectId: project.id,
    projectName: project.name,
    isFlow: frames.length > 0,
    totals: {
      steps: steps.length,
      frames: frames.length,
      approved: frames.filter((f) => f.approval === 'approved').length,
      changesRequested: frames.filter((f) => f.approval === 'changes').length,
      built,
      ready: ready.length,
      blocked: blocked.length,
      pendingComments: frames.reduce((sum, f) => sum + f.pendingComments, 0),
    },
    complete: frames.length > 0 && built === frames.length,
    steps,
    ready,
    blocked,
  };
}
