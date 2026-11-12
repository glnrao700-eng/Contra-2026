# CONTRA 2026 — 3D Fan Remake

A browser-based 3D run-and-gun inspired by the NES classic, rebuilt with modern rendering and real physics.
Fan-made tribute; not affiliated with Konami.

## Run it

It's a static site. Browsers block ES modules from `file://`, so serve the folder over HTTP:

```bash
cd contra-2026
python3 -m http.server 8080     # or: npx serve .
# open http://localhost:8080
```

Needs internet on first load: three.js r160 is loaded from `cdn.jsdelivr.net` via an import map.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Run | ← → / A D | D-pad / left stick |
| Aim (8-way) | ↑ ↓ + direction | stick |
| Prone | ↓ (standing) | down |
| Jump (hold = higher) | Space / Z / K | A |
| Drop through ledge | ↓ + Jump | down + A |
| Fire | Automatic (always on) | Automatic |
| Pause | P / Esc | Start |
| Toggle music | M | – |

Touch buttons appear automatically on touch devices.

## Features

- **Rendering:** PBR materials, image-based lighting generated from the procedural sky, soft shadows that follow the camera, ACES tone mapping, HDR bloom, fog, animated water, dust motes.
- **Physics:** fixed 120 Hz step, gravity, acceleration and friction, coyote time, jump buffering, variable jump height, one-way ledges, AABB collision.
- **Physics objects:** debris and ejected shell casings with gravity, bouncing, spin and water drag; artillery shells on ballistic arcs aimed at where you're heading; enemies knocked back when they die; bouncing weapon pickups.
- **Stage 1 (Jungle Assault):** river pits, a bridge that blows up under you, ledges, a raised plateau, runners, riflemen, rotating turrets, and flying weapon capsules.
- **Weapons:** Rifle, Machine Gun (M), Spread (S), piercing Laser (L).
- **Boss:** fortress wall with a core, two artillery cannons and soldier reinforcements.
- **Audio:** all synthesized with WebAudio (SFX plus a sequenced soundtrack).
- High score is saved in `localStorage`.

## Files

- `index.html`: page, HUD, import map
- `style.css`: HUD and menu styling
- `game.js`: the entire game (rendering, physics, AI, audio, input)
