# Pirates · Social tennis

A shared, responsive peg board for drop-in club doubles. No external services,
accounts, or runtime dependencies are required.

## Run

Install Node.js 22 or newer, then run `npm start` and open
<http://127.0.0.1:3000>. There are no packages to install.

The server saves the board in `data/session.json` after every change, using an
atomic file replacement. Restarting keeps the queue, courts, and recent history.
Use one server process per data file, on a persistent local filesystem. Back up
that file to preserve the session and saved player directory. Use **Start new
session** on the board to clear the queue, checked-in players, active courts,
completed-set total, and history, while keeping saved player profiles. This
requires confirmation and cannot be undone. To erase everything, including
saved players, stop the server and delete the data file.

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
Player names and ratings are stored locally until their profiles are deleted;
avoid entering sensitive information.

## Player directory

Open **Players** to add, search, edit, or delete saved profiles. Adding a profile
does not check the player in; use its **Check in** button or return to the board.
Use **+ Add player** on the session board to open the check-in popup. It closes
after a successful check-in; **Close** or Escape dismisses it without checking in.
New players entered at check-in are also saved automatically. Future check-ins
autocomplete from the directory and reuse the saved ability level; edit that
level on the Players screen. Names are unique regardless of case or extra spaces.
Check-in suggestions exclude everyone already in the session, including players
on court or taking a break. Leaving makes their saved name available again.

Profile edits also update a checked-in player's name and level without changing
their queue position, set count, or current court assignment. Leaving a session
does not delete the profile. A profile can only be deleted once that player has
left the session (finish their court first if necessary).

Saved profiles survive server restarts and new sessions. Existing session files
are upgraded automatically by saving their current players into the directory;
players who had already left before this upgrade cannot be recovered.

## Session rules

1. Check in with a name and a self-assessed ability (1–5). Players join the tail
   of the queue. Use a surname or initial when names clash.
2. The **first waiting player must play** and picks three others from the first
   seven, or all waiting players when fewer than seven are present.
3. Select players manually or use **Suggest a four**. Suggestions favour similar
   ability, fewer recent repeat court companions, then earlier queue positions.
   Suggestions are advisory; the first player can choose differently.
4. Send the four to the lowest-numbered open court, assigned automatically from
   six courts. Existing saved sessions gain courts 4–6 without losing active
   games. Players choose their own teams on court; the app lists the four without
   assigning partners or opponents. Players leave the waiting queue immediately.
5. Finish a set to return all four to the queue's tail in **2, 3, 4, 1** order,
   based on their queue positions immediately before the set started: the three
   other players in their previous queue order, then the picker last.
   Click order does not affect this. The preview shows the return order before
   starting. Sets played increase for each player. Sets already in progress
   retain their previously stored order, with the picker returning last.
6. **Break** removes a waiting player temporarily; **Rejoin** adds them at the end.
   **Leave** removes a waiting or resting player. Finish a court before removing
   someone playing.

The board refreshes every four seconds across devices. Conflicting edits are
rejected and the latest board is shown; retry your action after checking it.
The full-width queue uses four columns of player cards on desktop, two on tablets,
and one on phones. Twelve players fit in three rows on desktop, with check-in
available in a popup rather than a sidebar.
Court timers and wait times are informational, not automatic cutoffs. Agree short
sets or timed rounds when the club is busy. History retains the last 50 completed
sets, and group suggestions consider the last eight.

## Validate

- `npm test` — built-in Node tests for queue rules, suggestions, multiple courts,
  player management, session resets, legacy files, persistence, concurrent
  updates, and HTTP boundaries.
- `npm run check` — JavaScript syntax checks.

The navy-and-maroon broadcast-style interface uses local graphics, bold system
fonts, semantic controls, keyboard focus indicators, and responsive layouts.
No analytics, external fonts, or CDNs are used.