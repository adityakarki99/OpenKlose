// Primer (GitHub's design system) for previews. Kept in its own module so the
// token stylesheets load only with the chunk, when a sketch imports
// @primer/react — most sketches never pay for them.
import '@primer/primitives/dist/css/primitives.css';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';

export * from '@primer/react';
