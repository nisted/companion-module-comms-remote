# companion-module-comms-remote

A Bitfocus Companion connection module for the Comms Remote V2 box: comms mic mute and ear volume over OSC/UDP, with feedbacks from the box's real state, variables, presets, and the six box button targets that the [Comms Remote surface](https://github.com/nisted/companion-surface-comms-remote) mirrors.

See [companion/HELP.md](companion/HELP.md) for how to use it.

## Building

Every push builds the module package on GitHub (Actions tab → latest run → `companion-module-comms-remote` artifact). Import the `.tgz` in Companion with **Modules → Import module package**.

Locally: `corepack enable`, `yarn install`, `yarn package`. Tests: `yarn test` (after a build).

## Layout

- `src/main.ts`: Companion actions, feedbacks, variables and presets, and the UDP link to the box.
- `src/osc.ts`: just enough OSC for the box.
- `src/upgrades.ts`: upgrade scripts for buttons and triggers from older versions.

## OSC

The box listens on port 9000 (unless changed in its firmware) and replies to the sender.

| To the box | Arguments |
| --- | --- |
| `/comms/status` | none: the box replies with mute, volume and name |
| `/comms/mute` | int 1 = mute, 0 = live |
| `/comms/mute/toggle` | none |
| `/comms/volume` | int 0-100 |
| `/comms/name` | string, up to 24 characters |

| From the box | Arguments |
| --- | --- |
| `/comms/mute` | 1 / 0 |
| `/comms/volume` | 0-100 |
| `/comms/name` | string |
