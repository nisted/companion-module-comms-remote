# Comms Remote

Controls a Comms Remote V2 box (mic mute + volume) over OSC/UDP.

**Setup:** enter the IP address shown on the bottom of the box's screen. Port 9000 unless changed in firmware.

**Actions:** Mute (mute / unmute / toggle, or a variable), Set volume, Volume up / down (step per action), Set pack name, Set box address, Set box port. All value fields accept variables.

**Feedbacks:** Box is muted (red), Box is live (green), Box not responding (grey).

**Variables:** `state` (MUTED/LIVE), `muted` (1/0), `volume` (0-100), `connected` (1/0), `name` (pack name, needs firmware support).

**Presets:** mute toggle, mute, unmute, volume up/down, and a rotary (turn = volume, press = mute).

The box reports its real state back after every change, and the module polls it every 2 seconds.
