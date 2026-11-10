// A sibling module: the sandbox can't import this, the harness can.
export const greeting = (name) => `Hello, ${name}! (${__FIXTURE_CONFIG__})`;
