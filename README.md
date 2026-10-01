# Blackwood Manor

Multiplayer (1–8 players) browser horror game — Three.js + WebRTC (PeerJS). Runs as a static site.

## Play locally
```
npm install
npm run dev        # http://localhost:5173
```

## Deploy to Vercel
Push this folder to a GitHub repo, import it in Vercel (framework preset: **Vite**), deploy.
`vercel.json` already sets the build command, output folder and long-lived caching for models/textures.
To keep it private to your friends, enable **Settings → Deployment Protection → Password Protection**.

Multiplayer needs no server: the host clicks **Host Online** and shares the 4-letter code; friends choose
**Join Online** and enter it. If a friend on a strict network (some universities/companies) can't connect,
add a TURN server via env vars `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` (e.g. a free metered.ca account).

## Sound
All sounds are real CC0 recordings from Freesound, picked and mastered (silence trim, loudness normalisation)
by `python tools/audio/fetch_sfx.py`; footsteps are sliced from walking recordings by `tools/audio/slice_steps.py`.
Results land in `public/audio/` with `manifest.json` (sound key -> files) and `credits.json` (title, author, id).

## Characters and animation
Survivors and ghosts are MakeHuman (MPFB2) characters built by Blender scripts; motion is CMU motion capture
retargeted onto the shared rig. Run with Blender 5.2:
```
blender -b --factory-startup --python tools/blender/cast.py -- <id>        # survivor -> public/models/chars/<id>.glb
blender -b --factory-startup --python tools/blender/anims.py -- ava anim_f  # female mocap library
blender -b --factory-startup --python tools/blender/anims.py -- jake anim_m # male mocap library
blender -b --factory-startup --python tools/blender/cast.py -- g_widow      # ghost body, then:
blender -b --factory-startup --python tools/blender/ghost_anims.py -- widow # -> public/models/ghost_widow.glb
```

## Performance tip
On laptops with two GPUs, set your browser to **High performance** in
Windows Settings → System → Display → Graphics, or it will run on the integrated GPU.
