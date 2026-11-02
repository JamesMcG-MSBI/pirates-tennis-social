# Pirates · Social tennis

A shared, responsive peg board for drop-in club doubles. No external services,
accounts, or runtime dependencies are required.

## Run

Install Node.js 22 or newer, then run `npm start` and open
<http://127.0.0.1:3000>. There are no packages to install.

The server saves the board in `data/session.json` after every change, using an
atomic file replacement. Restarting keeps the queue, courts, and recent history.
Use one server process per data file, on a persistent local filesystem. Back up
that file to preserve a session; stop the server and delete it to start afresh.

Environment variables:

- `PORT`: listening port (default `3000`).
- `HOST`: listening address (default `127.0.0.1`). Set to `0.0.0.0` to allow
  other devices on a trusted club network to connect using the server's IP.
- `DATA_FILE`: alternative session file path (an absolute path is recommended).

**Trust boundary:** everyone with access to this app can manage every player and
court. It is designed for a trusted clubhouse tablet or trusted local network,
not an unauthenticated public website. Before exposing it to the internet, add
authentication, organiser permissions, HTTPS, and appropriate network controls.
A reverse proxy must preserve the original Host header for same-origin checks.
Player names and ratings are stored locally; avoid entering sensitive information.

## Session rules

1. Check in with a name and a self-assessed ability (1–5). Players join the tail
   of the queue. Use a surname or initial when names clash.
2. The **first waiting player must play** and picks three others from the first
   seven, or all waiting players when fewer than seven are present.
3. Select players manually or use **Suggest a four**. Suggestions favour similar
   ability, balanced teams, fewer recent repeat partners, then earlier queue
   positions. Suggestions are advisory; the first player can choose differently.
4. Send the four to one of three available courts. The app considers all three
   team pairings, prioritising balanced ability totals and then avoiding recent
   repeat partners. Players leave the waiting queue immediately.
5. Finish a set to return all four to the queue's tail, in their original queue
   order. Sets played increase for each player. Wins do not confer queue priority.
6. **Break** removes a waiting player temporarily; **Rejoin** adds them at the end.
   **Leave** removes a waiting or resting player. Finish a court before removing
   someone playing.

The board refreshes every four seconds across devices. Conflicting edits are
rejected and the latest board is shown; retry your action after checking it.
Court timers and wait times are informational, not automatic cutoffs. Agree short
sets or timed rounds when the club is busy. History retains the last 50 completed
sets, and partner suggestions consider the last eight.

## Validate

- `npm test` — built-in Node tests for queue rules, suggestions, multiple courts,
  persistence, concurrent updates, and HTTP boundaries.
- `npm run check` — JavaScript syntax checks.

The interface uses local assets, system fonts, semantic controls, keyboard focus
indicators, and responsive layouts. No analytics, external fonts, or CDNs are used.