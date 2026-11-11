---
name: klose-map
description: Map the whole app onto the local Klose canvas - one live card per route, then one card per state of each route (loading, empty, error, signed-out and so on). Use when the user says "/klose-map", asks to map the app, wants to see every page or every state of the product on one board, or asks what states a page has.
---

# klose-map: every route and every state, on one board

`klose map` finds the app's routes by reading its files and puts each page on the canvas as a live
card. That part is mechanical. Your part is the states: a page is not one picture, and the ones
nobody looks at (loading, empty, error) are the ones that ship broken. You read each route's code,
find the states it really has, and put each one beside its route.

This skill **reads** the app. It changes no real file.

## 1. Make sure the canvas is running

```
npx klose status
```

If it isn't running, `npx klose serve`. If the `klose` package can't be found, install it once
(`npm install -g klose`, or `npm install -g github:adityakarki99/OpenKlose` until it is on npm).

The route cards frame the app's own dev server, so that has to be running too (`npx expo start
--web`, `next dev`, `vite`). Ask the user to start it if it isn't; without it the cards are empty
frames.

## 2. Map the routes

Look first:

```
npx klose routes
```

It lists every route with its file and kind. It reads expo-router, Next.js (`app/` and `pages/`)
and, best effort, React Router. Tell the user how many pages it found. If it found none, or missed
some (a router it doesn't read, routes built at runtime), say so and add those cards yourself in
step 3's format, with `route` set.

Then put them on the canvas:

```
npx klose map --json
```

That creates (or updates) the project `App map` with one card per page route. It is safe to run
again: it only adds routes that have no card yet, and it never moves or rewrites a card.

- **Dynamic routes** (`/users/[id]`) come back under `needParams`. Find a real value (a seed file,
  a fixture, a link in the code) or ask the user, then run it again with
  `--param id=42` (repeatable; one value per param name).
- **A different dev server**: `--dev-server=http://localhost:3001`. Localhost only.
- **`missing`** lists routes that have cards but are no longer in the app. Tell the user; don't
  delete the cards yourself.

## 3. Find each route's states

For every route in the map, **read its file** (and what it renders: the data hook, the form, the
guard) and list the states that are really in the code. Look for:

- **loading** - a pending query, a `Suspense` fallback, a `loading.tsx`, a skeleton;
- **empty** - the list or result with nothing in it;
- **error** - a failed request, an `error.tsx`, an error boundary, a form that didn't validate;
- **signed-out / permission** - a redirect or a locked view when there is no session or no right;
- **long content** - very long names, many rows, overflow;
- anything specific to the page: a wizard step, a filter applied, a modal open, offline.

Only states the code has. If a page has no loading state at all, that is a finding for your
summary, not a card to invent.

If there are more than about ten routes, tell the user the count and ask which area to start with
rather than doing all of them at once.

## 4. One card per state, beside its route

Add each state as its own card with **both** `route` (exactly the route card's `route`) and `state`
(a short label: `loading`, `empty`, `error`). The canvas shows them as a chip on the card. Place it
to the right of or below its route card, same size, so a route and its states read as one group
(`npx klose project get <projectId>` gives you the route cards' `x`, `y`, `width`, `height`).

Render it the most real way available, and say which you used in `notes`:

1. **The real component, through the harness**, when the state is reachable through props. The
   repo needs a harness (`klose.config.json`; see the `/klose` skill). Mark the card built with the
   component's file and export, and give it the `props` that produce the state:

   ```
   npx klose project add-node <projectId> '{"name":"/orders - empty","route":"/orders","state":"empty","status":"built","builtFilePath":"src/screens/Orders.tsx","exportName":"OrdersList","props":{"orders":[]},"notes":"Real component via the harness, props {orders: []}."}'
   ```

2. **A live URL**, when the state has an address of its own (a query string, a step in the path):
   `"url":"http://localhost:3000/orders?status=none"`.

3. **A sketch**, when the state lives behind a network call, a session or a timer and neither of
   the above reaches it. Write `code` as in the `/klose` skill. When `npx klose harness sketches`
   says sketches are drawn by your bundler, import the route's real pieces (its loading skeleton,
   its empty state, its error component) and render them directly, so the card is the real thing in
   that state; otherwise write a self-contained restatement in the repo's real tokens and class
   names, copied from what the route's file renders in that state. Say in `notes` which it is and
   of which lines:

   ```
   npx klose project add-node <projectId> @/tmp/orders-error.json
   ```

   with `{"name":"/orders - error","route":"/orders","state":"error","code":"…","notes":"Restatement of src/screens/Orders.tsx:48-71 (the query's error branch); not reachable through props."}`.

Never fake a state by editing the app, mocking its network or changing its data.

## 5. Summarise

Give the user the canvas URL and:

- routes mapped, and any that still need params;
- states found, per route;
- how each was rendered: real (harness), live URL, or restatement;
- **states you could not render, and why** (needs a signed-in session, needs a server error, no
  harness in this repo);
- **states a route should have and doesn't** (a list with no empty state, a fetch with no error
  branch), with `file:line`.

Comments the user leaves on these cards are ordinary Klose feedback: read them with
`npx klose feedback` and handle them as the `/klose` skill describes.
