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
