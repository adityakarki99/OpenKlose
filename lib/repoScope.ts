/**
 * Which repo this page is about.
 *
 * A per-repo Klose server has exactly one repo, so its URLs don't name it:
 * `/projects`, `/api/projects`. A hub serves many, so there every page lives
 * under `/r/<repo-id>/…` and talks to `/api/repos/<repo-id>/…`.
 *
 * The repo is read from the address once, when the page loads. Moving to
 * another repo is a full page load (see `openRepo`), never a client-side
 * route change — that way nothing cached for one repo (the theme, open tabs,
 * undo history) can leak into another.
 */
const match = typeof window !== 'undefined' ? window.location.pathname.match(/^\/r\/([0-9a-f]{12})(?=\/|$)/) : null;

/** The hub's id for this repo, or null on a per-repo server (and on the hub's home page). */
export const REPO_ID: string | null = match ? match[1] : null;

/** React Router basename, so `navigate('/projects')` stays inside the repo. */
export const ROUTER_BASENAME: string | undefined = REPO_ID ? `/r/${REPO_ID}` : undefined;

/** Prefix for this repo's API. */
export const API_BASE: string = REPO_ID ? `/api/repos/${REPO_ID}` : '/api';

/** Address of a repo's canvas on the hub. */
export const repoHref = (id: string): string => `/r/${id}/projects`;

/** The hub's home page: every repo. */
export const HUB_HOME = '/';
