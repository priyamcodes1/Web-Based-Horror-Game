# Footstep library from walking recordings: fetch CC0 walking sequences per surface, detect individual steps
# (energy onsets), cut each with a short pre-roll + decay, master and keep the cleanest ones.
# Also removes hand-rejected sounds from the manifest (REJECT).
import json, os, subprocess, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import fetch_sfx as F

SEQ = {
    'step_wood': ['footsteps wood floor walking', 'walking on wooden floor', 'footsteps creaky wood'],
    'step_carpet': ['footsteps on carpet walking', 'walking carpet'],
    'step_tile': ['footsteps tile floor walking', 'walking on tiles', 'footsteps marble'],
    'step_stone': ['footsteps concrete walking', 'walking on stone floor'],
    'step_run': ['running footsteps wood', 'running on wooden floor', 'running footsteps indoor'],
}
REJECT = {  # key -> substrings of credit titles to drop
    'wail': ['Horny', 'Cartoony'], 'step_wood': ['Knocking'], 'heartbeat': ['CarCrash', 'beep'], 'crawl': ['Crawling Bu', 'nails'],
    'hum': ['Machine'], 'stinger': ['Ringer', 'Spring Pluck'], 'ambience_house': ['Vocal', 'Horn'],
}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32)


def onsets(x, sr=44100):
    hop = 256
    n = len(x) // hop
    e = np.sqrt(np.array([np.mean(x[i * hop:(i + 1) * hop] ** 2) for i in range(n)]) + 1e-12)
    env = 20 * np.log10(e + 1e-9)
    base = np.percentile(env, 30)
    out, last = [], -9999
    for i in range(2, n):
        if env[i] > base + 14 and env[i] - env[i - 2] > 7 and (i - last) * hop / sr > 0.28:
            out.append(i * hop); last = i
    return out, env, hop


def main():
    man_p = os.path.join(F.OUT, 'manifest.json'); cred_p = os.path.join(F.OUT, 'credits.json')
    manifest = json.load(open(man_p)); credits = json.load(open(cred_p))
    # ---- rejects
    for key, bad in REJECT.items():
        keep_f, keep_c = [], []
        for f, c in zip(manifest.get(key, []), credits.get(key, [])):
            if any(b.lower() in c['title'].lower() for b in bad):
                try: os.remove(os.path.join(F.OUT, f))
                except OSError: pass
                continue
            keep_f.append(f); keep_c.append(c)
        manifest[key], credits[key] = keep_f, keep_c
    # ---- sliced footsteps
    want = set(sys.argv[1:]) or set(SEQ)
    for key, queries in SEQ.items():
        if key not in want: continue
        seen, picks = set(), []
        for q in queries:
            for r in F.search(q):
                n = r['name'].lower()
                if r['id'] in seen or not (2.0 <= r['dur'] <= 40): continue
                if any(w in n for w in ('heel', 'horse', 'snow', 'gravel', 'leaves', 'grass', 'stairs', 'music')): continue
                if not any(w in n for w in ('step', 'walk', 'run', 'foot')): continue
                seen.add(r['id']); picks.append(r)
            time.sleep(1.2)
        picks.sort(key=lambda r: -r['dl'])
        cuts, creds = [], []
        for r in picks[:4]:
            raw = os.path.join(F.RAW, f"{r['id']}.mp3")
            if not os.path.exists(raw):
                d = F.get(r['mp3'], binary=True)
                if not d: continue
                open(raw, 'wb').write(d); time.sleep(0.5)
            x = decode(raw)
            if len(x) < 44100: continue
            on, env, hop = onsets(x)
            for o in on:
                a = max(0, o - int(0.012 * 44100)); b = min(len(x), o + int(0.42 * 44100))
                seg = x[a:b].copy()
                if len(seg) < 4000: continue
                # loudness and isolation: skip steps that bleed into the next one
                pk = np.abs(seg).max()
                tail = np.abs(seg[-2000:]).max()
                if pk < 0.02 or tail > pk * 0.5: continue
                cuts.append((pk, seg, r))
        cuts.sort(key=lambda c: -c[0])
        cuts = cuts[:10]
        os.makedirs(os.path.join(F.OUT, key), exist_ok=True)
        files, used = [], {}
        for i, (pk, seg, r) in enumerate(cuts):
            fade = np.ones(len(seg), np.float32); fl = int(0.08 * 44100); fade[-fl:] = np.linspace(1, 0, fl)
            seg = seg * fade
            tmpw = os.path.join(F.RAW, f'_cut_{key}_{i}.f32')
            seg.astype(np.float32).tofile(tmpw)
            rel = f'{key}/{key}_{i + 1}.mp3'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', tmpw,
                            '-af', 'loudnorm=I=-17:TP=-1.5', '-b:a', '128k', os.path.join(F.OUT, rel)], check=True)
            os.remove(tmpw)
            files.append(rel); used[r['id']] = r
        if files:
            manifest[key] = files
            credits[key] = [{'title': r['name'], 'author': r['user'], 'freesound': int(r['id']), 'license': 'CC0'} for r in used.values()]
        print(f'{key:12s} {len(files)} steps from ' + ' | '.join(f"{r['name'][:30]} ({r['user']})" for r in used.values()))
    json.dump(manifest, open(man_p, 'w'), indent=1); json.dump(credits, open(cred_p, 'w'), indent=1)


if __name__ == '__main__':
    main()
