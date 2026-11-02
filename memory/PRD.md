# The Traitors – Holiday Edition (Egypt)

## Original problem
Play The Traitors with 10–15 family players in one hotel in Egypt, ~12 days, 2 lives each, all murders in plain sight.

## User choices
- Traitors ≈ 1 in 5 (10→2, 15→3)
- Traitor gets a simple secret physical action from the app (family aged 40–60, keep it simple)
- One shared phone, each player has a 4-digit PIN
- Minimal: roles, murders, votes, lives

## Architecture
- Backend: FastAPI + MongoDB, one game document (key "current"); PINs stored hashed; public state hides roles of players still in the game
- Frontend: Expo Router stack: index (welcome/dashboard), setup, player/[id] (PIN pad + private turn/peek), reveal, how-to-play

## Daily loop (implemented 2026-06)
1. Setup: each player sees their role in private; Traitors pick the Day 1 victim and get a secret action
2. Day: a Traitor does the action on the victim, in plain sight
3. Round Table: each living player votes in private. Traitors also confirm the murder and pick tomorrow's victim
4. Reveal: the murder (if confirmed) costs 1 life and the banishment (most votes; tie = nobody) costs 1 life. A role is revealed only at 0 lives
5. Winning: no Traitors left → Faithful win. Traitors ≥ Faithful, or a Traitor survives Day 12 → Traitors win
- If the planned victim is knocked out the night before, Traitors choose a new victim through "Check my secret"

## Backlog
- P1: Limit wrong PIN attempts
- P2: History screen of all past days, custom action list, recruitment of new Traitors

## Iteration 2 (2026-06)
- Day History screen (/history): murder victim + action and Round Table result + vote tally for each day
- Secret actions editor (/actions): add, edit, delete and reset actions; saved in Mongo `settings` and kept between games
- Shareable Finale (/finale): picture of the final results made with react-native-view-shot and shared with expo-sharing (phone only; on web it shows a message instead)
- "Start a new game" now asks for confirmation first

## Iteration 3 (2026-06) - Several phones at once
- Every phone shares the one online game. The dashboard checks for updates every 4s and again when the app is reopened
- `/game/advance?expected=<phase>&expected_day=<day>` only moves the game on once, even if two phones tap the same button
- Game changes are handled one at a time (asyncio lock), so turns sent from different phones at the same moment are never lost
- How to play: new "Playing on several phones" card

## Iteration 4 (2026-06) - Game join codes
- Every game gets its own 5-character code (no look-alike characters, upper or lower case both work). Routes: /api/games, /api/games/{code}/...
- The phone remembers its code (storage key `game_code`). Welcome screen: Begin a new game / Join with a code (/join)
- The dashboard header shows the code; tap it to share. The menu has "Leave game on this phone" and "End this game for everyone"; other phones in an ended game are told it has ended
- Secret actions are now saved per game, not shared by all groups
- Each game has its own lock, so different groups don't slow each other down

## Iteration 5 (2026-06)
- The secret action used is never revealed: removed from the reveal screen, Day history and the public API (also stripped from older records). Traitors still see it privately.

## Iteration 6 (2026-06) - Skip a vote
- POST /api/games/{code}/skip {player_id, undo}: only at the Round Table. Counts the player's turn as done, they can still vote later, and it resets each day. history[].skipped lists who didn't vote
- Dashboard: Skip / Undo buttons on rows of players who haven't voted, with a confirm sheet that shows any error. The reveal says "Nobody voted tonight" when there are no votes. History shows "Didn't vote"
- If the only Traitor is skipped, that day's murder doesn't count, and the next day the Traitors pick a new victim through "Check my secret"
- Skipping a vote needs the skipper's name + PIN (by_id, pin). players[].skipped_by and history[].skipped_by show who skipped whom. Undo needs no PIN. Only players still in the game can skip.
