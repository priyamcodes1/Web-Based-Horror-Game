# Blackwood Manor

A multiplayer first-person horror game that runs in the browser (Chrome, Opera GX, Edge, Firefox).
Up to 5 friends are locked inside a haunted manor with 1–3 ghosts. Find the three keys, keep the lights on, and get out
through the front gate.

- **Engine:** three.js (WebGL2) + Vite
- **Multiplayer:** WebRTC through PeerJS. It needs no game server, so a static Vercel deployment works.
- **Assets:** characters, props, textures and animations were modelled, rigged and baked in Blender by the scripts in
  `tools/blender/`, then exported as compressed `.glb` files to `public/models/`.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

## Deploy to Vercel

Import the repository in Vercel. `vercel.json` already sets the build (`npm run build`) and output (`dist`) settings.
Every push redeploys the site. No environment variables or backend are required.

## Multiplayer

1. One player picks **Host Online** and clicks **Create Lobby**. The game shows a 5-letter room code.
2. Friends pick **Join Online**, enter the code and their name, and click **Join Lobby**.
3. The host chooses the map, ghosts, lives and difficulty, then clicks **Start Game**.

The host's browser runs the ghosts and the world. If the host leaves, the match ends.
Proximity voice chat is optional (Settings → *Proximity voice chat*, hold **V** to talk). Talking is heard through walls,
muffled, and ghosts can hear you too.

Connections go through the free public PeerJS broker and its TURN relays. On very strict networks (some school or
corporate Wi-Fi) WebRTC can be blocked. Mobile hotspots and home networks work.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Shift | Sprint (uses stamina) |
| C | Crouch. While sprinting: slide (speed boost) |
| E | Interact / open / pick up / hide / unlock |
| F | Flashlight |
| R | Swap in a fresh battery |
| Q / Left click | Use the selected item |
| 1–6 / Wheel | Select a hotbar slot |
| G | Drop the selected item |
| Space | Hold your breath while hiding |
| Tab | Map and objectives |
| V | Push-to-talk |
| Esc | Pause |

## How to escape

The front gate is chained with **brass**, **iron** and **silver** padlocks.

- **Iron key:** inside a bathroom that is bolted from the inside. Find the boarded-up vent next to it, pry the boards off
  with the **crowbar**, crouch through, and unlock the door from the inside.
- **Silver key:** behind glass in the museum room. Smash the case with the crowbar. Every ghost in the house hears it.
- **Brass key:** hidden in a drawer, usually upstairs.
- **Power:** at some point the power fails. Find the **fuse**, which glows when you are near it in the dark, and take it
  to the generator room. Later blackouts only trip the breaker lever.
- Unlock all three padlocks, then open the gate to trigger the escape cutscene.

Useful items: batteries, medkits, sedatives (heal + calm), adrenaline syringes (unlimited stamina), crucifixes (break a
ghost's grip once), and the music box (wind it and set it down to lure ghosts away).

## The ghosts

| Ghost | Behaviour |
| --- | --- |
| **The Widow** | Roams silently and weeps. She screams when she spots you and chases for a long time. Shining your flashlight in her face makes her flinch. |
| **The Hollow Child** | Nearly blind but hears very well. Faster than you can sprint, but loses interest quickly. She can crawl through open vents and sometimes just stares, giggles and vanishes. |
| **The Warden** | Slow but relentless. He tracks you by scent, smashes doors open, and his roar freezes your legs. You hear his chain first. |

Every ghost roams toward rooms where players have been, investigates noises (footsteps, doors, breaking glass, talking),
searches the last place it saw you, and sometimes checks wardrobes. If it saw you climb in, it will pull you out.
A hit costs health. A catch costs a life. Players who run out of lives spectate the survivors.

## Graphics settings

**Low / Medium / High / Max** change MSAA, shadow resolution, bloom, the number of dynamic lights and texture
resolution caps. The game always renders at native resolution. Performance comes from:

- portal culling (only rooms visible through open doorways are drawn)
- merging static geometry per room and material
- a fixed-size pool of real lights assigned to the nearest sources, so shaders never recompile
- compressed meshes (meshopt) and textures decoded off the main thread
- raw pointer-lock mouse input applied the moment it arrives, so aiming adds no frame of latency

## Custom sounds

All sounds are synthesized live by default. To use your own recordings, drop files into `public/audio/` named after the
sound they replace, for example:

```
public/audio/scream_1.ogg
public/audio/scream_2.ogg      (several files = random variation)
public/audio/footstep_01.wav
public/audio/whisper-long.mp3
public/audio/rain.ogg          (loops: rain, wind, drone, chase, menu, car, electric_hum)
```

`npm run dev`, `npm run build` and Vercel deploys rebuild `public/audio/manifest.json` automatically. You can also run
`npm run audio` to rebuild it by hand. Recognised names include: `footstep, heavy_step, door_creak, door_slam,
door_close, whisper, wail, weep, scream, giggle, hum, growl, roar, chain, stinger, thunder, heartbeat, musicbox, piano,
glass_break, wood_break, knock, rain, wind, drone, chase, menu` (see `tools/audio-manifest.cjs` for the full list).

## Project layout

```
src/core      renderer + post-processing, settings, input, asset loading
src/world     map definitions, level builder, furnishing rules, world assembly
src/game      game session, player, avatars, ghost AI, items, escape cutscene
src/net       PeerJS networking
src/audio     procedural audio engine
src/ui        HUD, menu widgets, styles
tools/blender Blender scripts that built every model, rig, animation and texture
```
