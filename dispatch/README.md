# fractonica-dispatch

Rings the app's moments on your phones as real calls. The app keeps the schedule of its calls on your Fractonica Hub;
the dispatch follows it there and, at each call's first ring, sends the phone an APNs VoIP push, which the phone rings
as an incoming call (CallKit) — locked or not, like any call. It is small (Node, no dependencies) and talks only
outwards: to the hub and to Apple. Later it will carry other cloud work too.

## Setting it up

1. **Once: your APNs auth key.** On developer.apple.com › Certificates, IDs & Profiles › Keys, make a key with *Apple
   Push Notifications service* and download it, `AuthKey_XXXXXXXXXX.p8`. Put it in this `dispatch/` folder (git
   ignores `*.p8` here). The dispatch keeps a copy in its data folder, readable by you alone.
2. **In the app:** Moments › Settings › Calls › *Calls* › *Pair a Dispatch*. The app asks your hub for a code and shows
   the command to run.
3. **On the computer** (one that reaches your hub and stays on — the one running the hub, say), from the repository:

   ```
   node dispatch/bin/dispatch.mjs 7KQ2-M9XD --hub http://192.168.0.29:8787
   ```

   It pairs with the hub, says so in the app, and from then on every moment rings as a call. Keep it running (a
   terminal, or a login item / launchd job); later it starts with `node dispatch/bin/dispatch.mjs` alone.

Choosing *Alarms* in the app turns the calls off; the dispatch stays paired, so choosing *Calls* again needs no code.

## Commands

```
node dispatch/bin/dispatch.mjs CODE [--hub URL]   pair with the hub, then run
node dispatch/bin/dispatch.mjs                    run with the saved pairing
node dispatch/bin/dispatch.mjs --call 2m          run, and ring every phone at that time too: a test call
node dispatch/bin/dispatch.mjs status             the pairing, the APNs key, the phones and their next calls
node dispatch/bin/dispatch.mjs test               ring every phone now, to try the setup
node dispatch/bin/dispatch.mjs test --call 14:30  ring every phone then, and quit: beside a dispatch that runs
node dispatch/bin/dispatch.mjs unpair             forget the pairing (revoke it on the hub's page too)

--hub URL  --apns-key FILE  --key-id ID  --team ID  --name NAME  --data DIR  --call WHEN   (--help for each)
```

## Test calls

To try a call without waiting for a moment, give the dispatch a time with `--call`: a delay (`90s`, `2m`, `1h30m`, or
`45` for seconds), a time of day (`14:30`, `14:30:15`: today, or tomorrow once it has passed) or a date and time
(`2026-11-09T14:30`). Give it more than once for more calls. Each phone in Calls mode rings then like a real call:
named like its next moment and ringing as long. Answer it, then open Fractonica from the call, and it opens as the
Moments screen's *Test a Call* does: the call screen picked up and filming. Decline it, and it is declined the same
way. A test call is never a moment of the calendar.

Only one dispatch runs per data folder, since two would ring every call twice. While one runs, a second start says so.
To ring a test call beside the running one, use `test --call` instead: it waits for the time, rings, and quits,
leaving the running dispatch's state alone.

The pairing and state live in `dispatch/data/` (or `--data`): `config.json` (the hub, the dispatch's token, the key's
id), the key, and `state.json` (the schedules held, the calls sent, the change feed's cursor).

## How it works

- **Pairing.** The app's code is the hub's (`POST /v1/pairings`, which a device may call for a `service` limited to
  `dispatch.*` records, hub/API.md). The dispatch redeems it like any client and keeps the token.
- **Schedules.** Each phone that rings by dispatch keeps one record, `dispatch.calls.<install>`: whether calls are on,
  where to push (its VoIP token, the push environment, the topic `app.fractonica.clock.voip`, the team) and the next
  calls for a few days, each `{ id, at, until, title, … }` — `at` the first ring, `until` when it rings out. The
  dispatch follows them with the hub's change feed (a long poll) and keeps them on disk, so calls go on while the hub
  is out of reach.
- **Calls.** Each call is pushed once, at `at` (and still while 10 s of its ringing are left, after a restart), as an
  APNs VoIP push (`apns-push-type: voip`, priority 10, expiring at `until`) whose `fx` is the call as the phone listed
  it. A token of the sandbox (a build from Xcode) is tried there when production calls it bad. Every push wakes the
  phone, which lists its next calls again, so the schedule rolls on by itself.
- **Status.** The dispatch writes `dispatch.status.<client id>` on start, after each call and every 10 minutes: its name,
  whether its APNs key works, its phones, its next and last call. The app shows it (Moments › Settings › Calls).

`npm test` (in `dispatch/`) checks the provider token, the pushes against a stand-in APNs, and a whole round with a hub:
pairing by the phone's code, calls on time and once, alert mode and back, a restart.
