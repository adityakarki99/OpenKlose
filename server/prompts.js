/**
 * The three things people most often ask Klose for, as prompts they can type
 * into Claude Code as they are. The CLI prints them after `init` and `setup`,
 * the welcome page and the hub show them with a copy button, and the /klose
 * skill (skills/klose/SKILL.md, "Three ways people start") knows how to carry
 * each one out — so the wording here and the skill's section must agree.
 *
 * Plain JS with no imports, so the canvas (Vite) and the CLI (Node) share it.
 */
export const SUGGESTED_PROMPTS = [
  {
    id: 'audit-all',
    title: 'Audit every page',
    prompt: '/klose audit every page against our design system',
    hint: 'One sketch per page: what is off-system, in which file and line, and what it should be.',
  },
  {
    id: 'audit-page',
    title: 'Audit one page and an interaction',
    prompt: '/klose audit the checkout page and what happens when the form fails',
    hint: 'Every state of that interaction side by side, so you can point at the exact element that is wrong.',
  },
  {
    id: 'ideate',
    title: 'Ideate a feature without breaking the system',
    prompt: '/klose ideate a notifications panel using only our existing components',
    hint: 'Built from the components you already have, in your tokens, and checked before it is written.',
  },
];
