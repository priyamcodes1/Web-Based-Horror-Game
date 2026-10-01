# Recorded sound library: searches Freesound for CC0 sounds per game sound key, picks the best-rated
# matches inside a duration window (with title include/exclude filters), downloads the HQ preview and
# masters it with ffmpeg (trim leading silence, loudness-normalise, short fade-out), then writes
# public/audio/manifest.json and public/audio/credits.json (title, author, Freesound id).
# Run: python tools/audio/fetch_sfx.py [key ...]        (no args = everything not yet fetched)
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request, html

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'audio')
RAW = os.path.join(ROOT, 'tools', 'audio', '_raw')
os.makedirs(OUT, exist_ok=True); os.makedirs(RAW, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackwoodManor-asset-fetch'}

# key: (queries, (min_s, max_s), count, include-any, exclude-any, mode)
#   mode: 'sfx' mono one-shot (-16 LUFS), 'loop' stereo ambience (-24 LUFS, no fade), 'voice' mono (-15 LUFS), 'ui' mono short (-20 LUFS)
L = [
    # ---- footsteps / movement
    ('step_wood', ['footsteps wood', 'footstep wooden', 'walking on wood floor', 'wood creaky footstep'], (0.1, 1.5), 8, ['step', 'foot', 'walk'], ['heel', 'loop', 'stairs', 'horse'], 'sfx'),
    ('step_carpet', ['footsteps carpet', 'carpet steps', 'soft footsteps indoor'], (0.1, 1.5), 6, ['step', 'foot', 'carpet'], ['heel', 'horse'], 'sfx'),
    ('step_tile', ['footstep tile floor', 'footstep marble', 'shoe step hard floor'], (0.12, 1.0), 6, ['step', 'foot'], ['heel', 'high'], 'sfx'),
    ('step_stone', ['footstep concrete', 'footstep stone', 'boot step concrete'], (0.12, 1.0), 6, ['step', 'foot'], ['heel'], 'sfx'),
    ('step_heavy', ['heavy footsteps', 'heavy boots footstep', 'stomp footstep', 'giant footstep'], (0.2, 2.0), 5, ['step', 'stomp', 'foot', 'boot'], ['robot', 'cartoon', 'horse'], 'sfx'),
    ('step_run', ['running footsteps', 'run footstep', 'footsteps fast'], (0.1, 1.2), 5, ['step', 'foot', 'run'], ['horse', 'heel'], 'sfx'),
    ('cloth', ['cloth rustle', 'clothes rustling', 'fabric movement', 'cloth movement'], (0.2, 2.0), 6, ['cloth', 'rustl', 'fabric'], [], 'sfx'),
    ('crawl', ['crawling', 'crawl', 'dragging body', 'knee crawl floor'], (0.4, 4.0), 4, ['crawl', 'drag'], ['insect', 'bug', 'car'], 'sfx'),
    ('slide', ['slide on floor', 'body slide wood floor', 'sliding floor shoes'], (0.4, 1.8), 4, ['slide', 'skid', 'slid'], ['guitar', 'whistle'], 'sfx'),
    ('land', ['body fall floor thud', 'body drop thud', 'falling body floor'], (0.3, 2.0), 4, ['fall', 'thud', 'drop', 'body'], [], 'sfx'),
    # ---- breath / player voice
    ('breath_heavy', ['breathing heavily', 'heavy breath', 'out of breath', 'panting'], (0.5, 4.0), 6, ['breath', 'pant'], ['dog', 'animal', 'monster'], 'voice'),
    ('breath_scared', ['scared breath', 'frightened breathing', 'nervous breath', 'anxious breathing'], (0.8, 6.0), 4, ['breath'], ['dog', 'monster'], 'voice'),
    ('gasp', ['gasp shock', 'sharp gasp', 'gasp for air'], (0.3, 2.0), 5, ['gasp'], [], 'voice'),
    ('hurt', ['pain grunt', 'hurt groan', 'ouch pain'], (0.3, 1.6), 6, ['pain', 'hurt', 'grunt', 'ouch', 'groan'], ['zombie', 'monster'], 'voice'),
    ('scream_victim', ['man scream terror', 'person screaming fear', 'terrified scream'], (0.6, 3.0), 4, ['scream'], ['monster', 'pig'], 'voice'),
    # ---- doors / props
    ('door_open', ['door creak open', 'old door opening creak', 'wooden door open squeak'], (0.8, 3.5), 6, ['door'], ['car', 'fridge', 'dishwasher', 'metal gate', 'garage'], 'sfx'),
    ('door_close', ['door close wood', 'closing wooden door', 'door shut'], (0.4, 2.0), 5, ['door', 'close', 'shut'], ['car', 'slam', 'fridge', 'garage'], 'sfx'),
    ('door_slam', ['door slam', 'slamming door wood', 'door slam loud'], (0.4, 2.5), 5, ['slam'], ['car'], 'sfx'),
    ('door_locked', ['locked door handle rattle', 'door handle jiggle locked', 'trying locked door'], (0.4, 2.5), 4, ['lock', 'handle', 'rattle', 'jiggle'], ['car'], 'sfx'),
    ('door_bang', ['banging on door', 'door kicked open', 'door bash'], (0.5, 3.0), 4, ['bang', 'kick', 'bash', 'pound'], [], 'sfx'),
    ('unlock', ['key unlock door', 'key in lock turn', 'unlocking padlock'], (0.3, 2.0), 5, ['key', 'lock', 'unlock'], ['keyboard'], 'sfx'),
    ('drawer_open', ['drawer open wood', 'wooden drawer opening', 'desk drawer open'], (0.3, 1.8), 5, ['drawer'], [], 'sfx'),
    ('drawer_close', ['drawer close', 'wooden drawer closing'], (0.2, 1.5), 4, ['drawer'], [], 'sfx'),
    ('wardrobe', ['wardrobe door creak', 'cabinet door creak', 'closet door open'], (0.5, 2.5), 5, ['wardrobe', 'cabinet', 'closet', 'cupboard'], [], 'sfx'),
    ('bed_creak', ['bed creak', 'bed springs creak', 'old bed squeak'], (0.4, 2.5), 4, ['bed', 'spring'], [], 'sfx'),
    ('pickup', ['pick up item', 'grab object', 'item pickup cloth'], (0.15, 0.9), 5, ['pick', 'grab', 'item'], ['game', 'coin', 'powerup', '8bit', 'retro'], 'sfx'),
    ('keys', ['keys jingle', 'bunch of keys', 'keys pickup'], (0.3, 1.8), 4, ['key'], ['keyboard', 'piano'], 'sfx'),
    ('battery', ['battery', 'battery click', 'plastic snap click', 'remote battery'], (0.1, 2.0), 4, ['battery', 'click', 'snap'], [], 'sfx'),
    ('flashlight', ['flashlight click', 'torch switch click', 'flashlight on off'], (0.05, 0.6), 5, ['flashlight', 'torch', 'click', 'switch'], [], 'ui'),
    ('glass_break', ['glass break', 'window smash', 'glass shatter'], (0.5, 3.0), 4, ['glass', 'shatter', 'smash'], [], 'sfx'),
    ('wood_break', ['wood break crack', 'wooden plank snap', 'board breaking'], (0.4, 2.5), 4, ['wood', 'plank', 'board', 'break', 'snap'], [], 'sfx'),
    ('lever', ['lever pull metal', 'switch lever heavy', 'breaker switch'], (0.3, 2.0), 4, ['lever', 'switch', 'breaker'], [], 'sfx'),
    ('fuse', ['fuse insert', 'plug in socket', 'electrical spark'], (0.2, 1.5), 4, ['fuse', 'plug', 'spark', 'socket'], [], 'sfx'),
    ('power_down', ['power down', 'electricity shut down', 'power failure'], (1.0, 4.0), 3, ['power', 'shut', 'down'], ['laser', 'game', '8bit'], 'sfx'),
    ('power_up', ['power up electricity', 'generator start', 'electrical hum start'], (1.0, 5.0), 3, ['power', 'generator', 'hum', 'electric'], ['laser', 'game', '8bit', 'retro'], 'sfx'),
    ('light_buzz', ['fluorescent light flicker', 'light buzz flicker', 'electric buzz bulb'], (1.0, 5.0), 3, ['buzz', 'flicker', 'light', 'fluorescent'], [], 'sfx'),
    ('bulb_pop', ['bulb pop', 'light bulb explode', 'bulb break', 'lightbulb'], (0.1, 2.0), 3, ['bulb', 'pop'], [], 'sfx'),
    ('object_fall', ['object falls on floor', 'book falling floor', 'wood object drop'], (0.3, 2.0), 6, ['fall', 'drop', 'book'], [], 'sfx'),
    ('frame_fall', ['picture frame falling', 'painting falls off wall', 'frame drop'], (0.4, 2.5), 3, ['frame', 'picture', 'painting', 'fall'], [], 'sfx'),
    ('chair_scrape', ['chair scrape floor', 'chair dragging', 'furniture drag'], (0.5, 3.0), 4, ['chair', 'drag', 'scrape', 'furniture'], [], 'sfx'),
    ('knock', ['knocking on door', 'knock knock wood', 'three knocks'], (0.5, 3.0), 4, ['knock'], [], 'sfx'),
    ('whoosh', ['whoosh', 'swoosh fast', 'swish'], (0.2, 1.4), 4, ['whoosh', 'swoosh', 'swish'], [], 'sfx'),
    ('swipe', ['swipe', 'slash', 'claw', 'swing whoosh'], (0.1, 1.2), 4, ['swipe', 'slash', 'claw', 'swing', 'whoosh'], ['sword', 'metal'], 'sfx'),
    ('hit_body', ['punch body hit', 'body impact', 'hit flesh'], (0.1, 1.0), 4, ['punch', 'hit', 'impact'], [], 'sfx'),
    ('bone_crack', ['bone crack', 'bone break snap', 'neck snap'], (0.2, 1.5), 3, ['bone', 'crack', 'snap'], [], 'sfx'),
    ('heal', ['bandage wrap', 'first aid kit open', 'zipper open bag'], (0.4, 2.5), 3, ['bandage', 'aid', 'zip', 'kit'], [], 'sfx'),
    ('inject', ['syringe', 'injection', 'needle'], (0.2, 3.0), 3, ['syringe', 'inject', 'needle'], [], 'sfx'),
    ('pills', ['pill bottle shake', 'pills rattle'], (0.3, 2.0), 3, ['pill', 'rattle', 'bottle'], [], 'sfx'),
    ('paper', ['paper unfold', 'paper rustle page', 'letter open'], (0.3, 2.0), 4, ['paper', 'page', 'letter'], [], 'sfx'),
    ('book_page', ['book page turn', 'page flip'], (0.2, 1.4), 4, ['page', 'book', 'flip'], [], 'ui'),
    ('chain', ['chain rattle', 'chains dragging', 'metal chain drag'], (0.6, 4.0), 5, ['chain'], [], 'sfx'),
    ('clock_chime', ['clock chime', 'clock strike', 'clock bell', 'grandfather clock'], (1.5, 20.0), 2, ['clock', 'chime', 'bell'], ['alarm'], 'sfx'),
    ('clock_tick', ['clock ticking', 'grandfather clock tick'], (4.0, 30.0), 1, ['tick', 'clock'], [], 'loop'),
    ('phone_ring', ['old telephone ring', 'vintage phone ringing', 'rotary phone ring'], (2.0, 10.0), 2, ['phone', 'telephone'], ['mobile', 'cell', 'smartphone'], 'sfx'),
    ('radio_static', ['radio static', 'radio tuning noise', 'white noise radio'], (2.0, 12.0), 2, ['radio', 'static'], [], 'sfx'),
    ('music_box', ['music box', 'music box lullaby', 'musicbox melody'], (5.0, 40.0), 2, ['music box', 'musicbox'], [], 'sfx'),
    ('piano_creepy', ['creepy piano', 'piano dissonant chord', 'scary piano notes'], (1.5, 10.0), 3, ['piano'], [], 'sfx'),
    ('bell', ['hand bell', 'small bell ring', 'bell ring'], (0.3, 5.0), 3, ['bell'], ['church', 'school', 'doorbell', 'bicycle', 'alarm'], 'sfx'),
    ('baby_cry', ['baby crying distant', 'baby cry'], (2.0, 10.0), 2, ['baby'], [], 'voice'),
    ('water_drip', ['water dripping', 'dripping tap', 'drip drop water'], (3.0, 30.0), 2, ['drip'], [], 'loop'),
    ('rope_creak', ['rope creak', 'wood creak swing', 'creaking rope tension'], (1.0, 5.0), 3, ['creak', 'rope'], [], 'sfx'),
    ('house_creak', ['old house creak', 'wood floor creak', 'creaking wood beam'], (0.8, 5.0), 6, ['creak'], ['door'], 'sfx'),
    ('glass_tap', ['tapping on window', 'knocking on glass', 'window tap'], (0.5, 4.0), 3, ['tap', 'knock', 'glass', 'window'], [], 'sfx'),
    ('window_bang', ['window slam wind', 'shutter bang wind', 'window shut'], (0.5, 3.0), 3, ['window', 'shutter', 'bang', 'slam'], [], 'sfx'),
    ('candle_out', ['blow out candle', 'candle extinguish', 'candle blow'], (0.3, 2.0), 3, ['candle', 'blow'], [], 'sfx'),
    ('thunder', ['thunder', 'thunder crack close', 'distant thunder rumble'], (3.0, 16.0), 4, ['thunder'], ['music'], 'sfx'),
    ('car_door', ['car door close', 'car door slam'], (0.3, 2.0), 2, ['car', 'door'], [], 'sfx'),
    ('car_start', ['car engine start', 'car ignition start'], (2.0, 8.0), 1, ['car', 'engine', 'start', 'ignition'], [], 'sfx'),
    ('car_idle', ['car engine idle', 'car interior driving'], (6.0, 40.0), 1, ['car', 'engine', 'idle', 'driving'], [], 'loop'),
    # ---- ghosts
    ('weep', ['woman crying', 'female crying', 'woman sobbing', 'crying woman'], (1.5, 15.0), 4, ['cry', 'sob', 'weep'], ['baby', 'child', 'man', 'male', 'boy'], 'voice'),
    ('wail', ['woman moaning', 'ghost moan', 'female wail', 'eerie moan'], (1.0, 8.0), 4, ['moan', 'wail'], ['cartoon', 'male', 'zombie', 'sexy', 'pleasure'], 'voice'),
    ('ghost_whisper', ['creepy whisper', 'ghost whisper', 'whispering voices'], (1.0, 6.0), 6, ['whisper'], [], 'voice'),
    ('scream_ghost', ['woman scream horror', 'female scream', 'banshee scream'], (0.6, 4.0), 5, ['scream', 'shriek'], ['male', 'man ', 'child', 'pig'], 'voice'),
    ('laugh_ghost', ['evil woman laugh', 'creepy female laugh', 'witch laugh'], (0.8, 5.0), 4, ['laugh', 'cackle'], ['man ', 'male', 'baby', 'crowd'], 'voice'),
    ('giggle', ['little girl giggle', 'creepy child giggle', 'child laugh'], (0.4, 3.5), 5, ['giggle', 'laugh'], ['baby', 'crowd', 'kids playing'], 'voice'),
    ('hum', ['humming lullaby', 'woman humming', 'girl humming', 'creepy humming'], (2.0, 20.0), 3, ['humming', 'hum '], ['machine', 'electric', 'fridge', 'motor', 'neon'], 'voice'),
    ('child_whisper', ['child whispering', 'kid whisper', 'girl whispering', 'whisper'], (0.6, 6.0), 3, ['whisper'], [], 'voice'),
    ('growl', ['monster growl', 'deep growl creature', 'beast growl'], (0.8, 4.0), 5, ['growl'], ['dog', 'stomach', 'cat'], 'voice'),
    ('roar', ['monster roar', 'creature roar', 'beast roar'], (1.0, 5.0), 4, ['roar'], ['lion', 'engine', 'crowd', 'dinosaur toy'], 'voice'),
    ('breath_monster', ['monster breathing', 'creature heavy breath', 'beast breathing'], (1.0, 6.0), 3, ['breath'], [], 'voice'),
    ('jumpscare', ['jumpscare scream', 'horror scream jumpscare', 'scare sting scream'], (0.5, 3.0), 4, ['scream', 'jump', 'scare'], [], 'voice'),
    ('stinger', ['horror stinger', 'scary sting', 'horror hit', 'jump scare sting'], (0.8, 6.0), 5, ['sting', 'hit', 'horror', 'scare'], ['music loop', 'ringer', 'piano'], 'sfx'),
    ('vanish', ['ghost whoosh', 'reverse whoosh spooky', 'spirit vanish'], (0.5, 3.0), 3, ['whoosh', 'ghost', 'reverse', 'spirit'], [], 'sfx'),
    # ---- ambience / loops
    ('rain_window', ['rain on window', 'rain window', 'rain indoors', 'rain against glass'], (20.0, 240.0), 2, ['rain'], ['thunder', 'music'], 'loop'),
    ('rain_heavy', ['heavy rain outside', 'rain storm loop'], (20.0, 180.0), 1, ['rain'], [], 'loop'),
    ('wind_house', ['wind howling', 'howling wind', 'wind through house', 'wind whistle'], (15.0, 180.0), 2, ['wind'], ['music', 'chime'], 'loop'),
    ('ambience_house', ['haunted house ambience', 'creepy room tone', 'horror ambience', 'abandoned house ambience'], (30.0, 240.0), 2, ['ambien', 'room', 'house', 'tone'], ['music', 'vocal', 'horn'], 'loop'),
    ('heartbeat', ['heartbeat', 'heart beat loop', 'heartbeat slow'], (3.0, 60.0), 2, ['heart'], ['beep', 'monitor', 'hospital', 'ecg'], 'loop'),
    ('menu_ambience', ['dark ambient', 'horror ambience drone', 'dark drone'], (30.0, 240.0), 2, ['dark', 'drone', 'ambien'], ['music', 'beat'], 'loop'),
    ('chase_loop', ['horror tension loop', 'suspense drone tension', 'horror chase'], (8.0, 120.0), 1, ['tension', 'suspense', 'chase', 'horror'], [], 'loop'),
    # ---- UI
    ('ui_hover', ['ui hover soft', 'button hover sound', 'menu tick soft'], (0.03, 0.4), 3, ['hover', 'tick', 'ui', 'menu', 'button'], [], 'ui'),
    ('ui_click', ['ui click', 'button click menu', 'menu select click'], (0.03, 0.6), 3, ['click', 'select', 'button', 'ui'], [], 'ui'),
    ('ui_back', ['ui back cancel', 'menu back click', 'button cancel'], (0.05, 0.7), 2, ['back', 'cancel', 'click', 'close'], [], 'ui'),
    ('ui_open', ['book open', 'menu open whoosh'], (0.3, 1.6), 2, ['book', 'open'], [], 'ui'),
]
LUFS = {'sfx': -16, 'loop': -24, 'voice': -15, 'ui': -20}


def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                d = r.read()
                return d if binary else d.decode('utf8', 'ignore')
        except Exception as e:
            time.sleep(2 + i * 3)
    return None


def search(q):
    url = 'https://freesound.org/search/?' + urllib.parse.urlencode({'q': q, 'f': 'license:"Creative Commons 0"', 's': 'Downloads', 'g': '1'})
    page = get(url) or ''
    out = []
    for blk in page.split('data-sound-id="')[1:]:
        sid = blk.split('"', 1)[0]
        mp3 = re.search(r'data-mp3="([^"]+)"', blk)
        dur = re.search(r'duration="([\d.]+)"', blk)
        titles = re.findall(r'title="([^"]{2,120})"', blk)
        user = re.search(r'/people/([^/"]+)/', blk)
        dl = re.search(r'title="(\d+) downloads"', blk)
        lic = 'Creative Commons 0' in blk
        if not (mp3 and dur and lic):
            continue
        name = html.unescape(titles[0]) if titles else sid
        out.append({'id': sid, 'mp3': mp3.group(1).replace('-lq.mp3', '-hq.mp3'), 'dur': float(dur.group(1)), 'name': name,
                    'user': user.group(1) if user else '?', 'dl': int(dl.group(1)) if dl else 0})
    return out


def master(src, dst, mode):
    lufs = LUFS[mode]
    ch = '2' if mode == 'loop' else '1'
    af = []
    if mode != 'loop':
        af.append('silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.01')
    af.append(f'loudnorm=I={lufs}:TP=-1.5:LRA=11')
    if mode != 'loop':
        af.append('areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.05,afade=t=in:d=0.04,areverse')
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af', ','.join(af), '-ac', ch, '-ar', '44100', '-b:a', '160k' if mode == 'loop' else '128k', dst]
    subprocess.run(cmd, check=True)


def main():
    want = set(sys.argv[1:])
    man_p = os.path.join(OUT, 'manifest.json'); cred_p = os.path.join(OUT, 'credits.json')
    manifest = json.load(open(man_p)) if os.path.exists(man_p) else {}
    credits = json.load(open(cred_p)) if os.path.exists(cred_p) else {}
    manifest = {k: v for k, v in manifest.items() if isinstance(v, list) and v}
    for key, queries, (lo, hi), count, inc, exc, mode in L:
        if want and key not in want: continue
        if not want and manifest.get(key): continue
        seen, picks = set(), []
        for q in queries:
            res = search(q); time.sleep(1.2)
            for r in res:
                n = r['name'].lower()
                if r['id'] in seen or not (lo <= r['dur'] <= hi): continue
                if inc and not any(w in n for w in inc): continue
                if any(w in n for w in exc): continue
                seen.add(r['id']); picks.append(r)
        picks.sort(key=lambda r: -r['dl'])
        picks = picks[:count]
        files, creds = [], []
        os.makedirs(os.path.join(OUT, key), exist_ok=True)
        for i, r in enumerate(picks):
            raw = os.path.join(RAW, f"{r['id']}.mp3")
            if not os.path.exists(raw):
                d = get(r['mp3'], binary=True)
                if not d: continue
                open(raw, 'wb').write(d); time.sleep(0.5)
            rel = f'{key}/{key}_{i + 1}.mp3'
            try:
                master(raw, os.path.join(OUT, rel), mode)
            except Exception as e:
                print('  master fail', r['id'], e); continue
            files.append(rel)
            creds.append({'title': r['name'], 'author': r['user'], 'freesound': int(r['id']), 'license': 'CC0'})
        manifest[key] = files; credits[key] = creds
        print(f'{key:16s} {len(files)}/{count}  ' + ' | '.join(f"{c['title'][:34]} ({c['author']})" for c in creds))
        json.dump(manifest, open(man_p, 'w'), indent=1); json.dump(credits, open(cred_p, 'w'), indent=1)


if __name__ == '__main__':
    main()
