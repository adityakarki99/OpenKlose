import * as store from './store.js';
import { enrichedIndex } from './componentIndex.js';
import { classifySketches, sketchOverlaps } from './classify.js';
import { lintSketch } from './lint.js';
import { triageComments } from './triage.js';

/**
 * The Jev-backed answers about a project's own content — as opposed to
 * server/componentIndex.js, which is about the repo's components:
 *
 *   classifyProject   what each sketch is (role, kind), and which of the
 *                     repo's primitives it looks like a second copy of
 *   triageProject     what each open comment asks for, and how much work it is
 *   lintNode          which literal design values a sketch uses where the
 *                     repo has a token, and (with Jev) what to use instead
 *
 * All three write their answers back into the project file, so the canvas
 * (through the live-update stream) and the agent (through `klose project get`
 * and `klose feedback`) read the same thing.
 */

/**
 * Classify a project's sketches (those in `nodeIds`, or all of them) and
 * record the answers on the nodes. Resolves to
 *   { summary, sketches: [{ id, name, classification, overlaps }] }
 * where `overlaps` lists classified primitives of the repo with the same kind
 * as a sketch Jev called a primitive. Needs a key; throws JevError without.
 */
export async function classifyProject(root, projectId, { home, jev, nodeIds, force = false } = {}) {
  const project = await store.getProject(root, projectId);
  const wanted = nodeIds ? new Set(nodeIds) : null;
  const nodes = (project.nodes || []).filter((n) => !wanted || wanted.has(n.id));
  const { results, summary } = await classifySketches(nodes, { ...jev, force });
  const { components } = await enrichedIndex(root, { home });
  const byId = {};
  for (const node of nodes) {
    const classification = results[node.id] || (node.classification?.key && !force ? node.classification : null);
    if (!classification) continue;
    const overlaps = sketchOverlaps(classification, components);
    byId[node.id] = { ...classification, overlaps };
  }
  if (Object.keys(byId).length) await store.setNodeClassifications(root, projectId, byId);
  const classifiedPrimitives = components.filter((c) => c.role === 'primitive').length;
  return {
    summary: { ...summary, classifiedPrimitives },
    sketches: nodes.map((n) => ({ id: n.id, name: n.name, classification: byId[n.id] || null, overlaps: byId[n.id]?.overlaps || [] })),
  };
}

/**
 * Triage the open comments of one project (or of every project when
 * `projectId` is null), recording the answers on the comments. Resolves to
 *   { summary, feedback }  — the same list `klose feedback` prints, each
 * comment now carrying its `triage`.
 */
export async function triageProject(root, { projectId = null, nodeIds, jev, force = false } = {}) {
  const projects = projectId ? [await store.getProject(root, projectId)] : await Promise.all((await store.listProjects(root)).map((p) => store.getProject(root, p.id)));
  const wanted = nodeIds ? new Set(nodeIds) : null;
  const summary = { total: 0, triaged: 0, cached: 0, failed: 0, error: null };
  for (const project of projects) {
    const nodes = (project.nodes || []).filter((n) => (!wanted || wanted.has(n.id)) && (n.comments || []).some((c) => !c.resolvedAt));
    if (!nodes.length) continue;
    const { results, summary: s } = await triageComments(nodes, { ...jev, force });
    for (const key of ['total', 'triaged', 'cached', 'failed']) summary[key] += s[key];
    summary.error ??= s.error;
    if (Object.keys(results).length) await store.setCommentTriage(root, project.id, results);
    if (s.error && /TYPESAFE_API_KEY was rejected|could not reach/.test(s.error)) break;
  }
  const feedback = await store.listFeedback(root, { projectId: projectId || undefined });
  return { summary, feedback: wanted ? feedback.filter((f) => wanted.has(f.nodeId)) : feedback };
}

/** Lint one sketch's preview code against the repo's tokens. See server/lint.js. */
export async function lintNode(root, projectId, nodeId, { jev, useJev = true } = {}) {
  const project = await store.getProject(root, projectId);
  const node = (project.nodes || []).find((n) => n.id === nodeId);
  if (!node) {
    const { notFound } = await import('./errors.js');
    throw notFound(`Node ${nodeId} not found in project ${projectId}`, 'NODE_NOT_FOUND');
  }
  const result = await lintSketch(root, node.code || '', { jev, useJev });
  return { projectId, nodeId, name: node.name, hasCode: !!node.code, ...result };
}
