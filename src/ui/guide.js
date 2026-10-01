// The Field Guide: an in-game book (B) with chapter tabs, aged pages and real reference photographs rendered
// from the game's own models (ghosts, hiding places, items). Opening it frees the cursor; online games keep
// running around you, so read fast.
import { CharStage } from './preview.js';
import { audio } from '../audio/audio.js';

const CH = [
  { id: 'manor', tab: 'The Manor', title: 'Blackwood Manor', photo: { prop: ['furniture', 'Clock'] }, body: `
    <p class="lead">The door slammed the moment you crossed the threshold. It will not open again until three locks are undone.</p>
    <h4>Getting out</h4>
    <ul><li><b>Brass key</b> — hidden in a drawer somewhere. Open dressers and nightstands.</li>
    <li><b>Silver key</b> — behind glass in the collection. You will need something to break it with.</li>
    <li><b>Iron key</b> — where the Lady bathed. That room is locked from the inside; find another way in.</li>
    <li>The main gate's bolt is electric. <b>The power must be on</b> to open it.</li></ul>
    <h4>The house</h4>
    <p>Hold <kbd>Tab</kbd> for the map of rooms you have visited. Doors can be closed behind you; it breaks their line of sight. Vents are too small for most of them.</p>` },
  { id: 'widow', tab: 'The Widow', title: 'The Widow', photo: { ghost: 'ghost_widow' }, body: `
    <p class="lead">Edmund's wife. She still wears the dress. She still cries at night.</p>
    <h4>How she hunts</h4>
    <ul><li>Roams <b>silently</b>, weeping. If you hear crying, she is near.</li>
    <li>When she <b>spots you she screams</b> — then she chases for a long, long time.</li>
    <li>She reaches for you with both hands as she runs.</li></ul>
    <h4>Surviving her</h4>
    <ul><li><b>Shine your flashlight in her face.</b> She covers her eyes, cries out and flees — then vanishes.</li>
    <li>It only works on her face, and not twice in quick succession.</li>
    <li>She will lift you by the throat. You will not like it.</li></ul>` },
  { id: 'child', tab: 'The Hollow Child', title: 'The Hollow Child', photo: { ghost: 'ghost_child' }, body: `
    <p class="lead">Lily. Nobody let the doctor examine her. Nobody found her afterwards.</p>
    <h4>How she hunts</h4>
    <ul><li><b>Nearly blind</b> — but she <b>hears very well</b>. Sprinting, slamming doors and talking carry.</li>
    <li><b>Faster than you can sprint</b>, but she <b>loses interest quickly</b>. Break the chase and she wanders off.</li>
    <li>She <b>crawls through open vents</b> — the one place you thought was safe.</li>
    <li>Sometimes she just <b>stands and stares</b>, giggles… and is gone.</li></ul>
    <h4>Surviving her</h4>
    <ul><li>Crouch-walk (<kbd>C</kbd>) — your footsteps are nearly silent.</li>
    <li>A flashlight in her face makes her shriek and scurry away.</li>
    <li>She adores the music box in the nursery. Wind it to draw her off.</li></ul>` },
  { id: 'warden', tab: 'The Warden', title: 'The Warden', photo: { ghost: 'ghost_warden' }, body: `
    <p class="lead">The groundskeeper, or what was left of him. He replaced the chain himself.</p>
    <h4>How he hunts</h4>
    <ul><li><b>Slow but relentless.</b> He does not give up the way the others do.</li>
    <li>He <b>tracks you by scent</b> — he will walk the path you walked.</li>
    <li>He doesn't open doors. He <b>smashes them in</b>.</li>
    <li>His <b>roar freezes your legs</b> if he catches you in the open.</li>
    <li><b>You hear his chain first.</b> Listen for it.</li></ul>
    <h4>Surviving him</h4>
    <ul><li>Light only makes him shield his eyes — and come on angrier.</li>
    <li>Outpace him, then hide well. Hold your breath when he checks.</li></ul>` },
  { id: 'hide', tab: 'Hiding', title: 'Hiding', photo: { prop: ['furniture', 'Wardrobe'] }, photo2: { prop: ['furniture', 'Bed'] }, body: `
    <p class="lead">Every bedroom has somewhere to disappear.</p>
    <ul><li><b>Wardrobes</b> — press <kbd>E</kbd> to step in. The doors stay ajar so you can watch the room.
      Hold <kbd>W</kbd> to ease them wider and see more — but if something is close, it can see you too.</li>
    <li><b>Under beds</b> — press <kbd>E</kbd> at the side of a bed to get down and crawl under. You will see feet. Pray they walk past.</li>
    <li>Hold <kbd>Space</kbd> to <b>hold your breath</b> when they search. Not for too long.</li>
    <li>If one of them <b>sees you climb in</b>, hiding will not save you.</li>
    <li>Your torch goes dark while you hide. Others hear you muffled.</li></ul>` },
  { id: 'light', tab: 'Light & Power', title: 'Light & Power', photo: { prop: ['items', 'Flashlight'] }, body: `
    <ul><li><kbd>F</kbd> toggles your flashlight. Batteries drain — <kbd>R</kbd> swaps in a fresh one.</li>
    <li>A torch makes you easier to see from afar. Darkness hides you, and frays your nerves.</li>
    <li>The <b>power fails</b>. When it does, find a fuse (it glows faintly), seat it in the generator room and pull the lever.</li>
    <li>Ghosts near electric lights make them stutter. Watch the bulbs.</li></ul>` },
  { id: 'items', tab: 'Items', title: 'Things worth carrying', photo: { prop: ['items', 'Crucifix'] }, photo2: { prop: ['items', 'Medkit'] }, body: `
    <ul><li><b>Battery</b> — <kbd>R</kbd> to swap into the torch.</li>
    <li><b>Medical kit</b> — heals most of your wounds.</li>
    <li><b>Adrenaline</b> — a burst of speed and stamina.</li>
    <li><b>Sedatives</b> — steadies the mind.</li>
    <li><b>Crucifix</b> — hold it up (<kbd>Q</kbd> / click) to drive back the ghost in front of you.</li>
    <li><b>Crowbar</b> — breaks display glass and boarded vents.</li>
    <li><b>Fuse</b> — for the generator.</li></ul>
    <p><kbd>1–6</kbd> or the wheel selects, <kbd>G</kbd> drops.</p>` },
  { id: 'events', tab: 'The House Stirs', title: 'Hauntings & side quests', photo: { prop: ['items', 'MusicBox'] }, body: `
    <p class="lead">The manor does not wait for you. It moves.</p>
    <ul><li>Doors slam — sometimes every door in the room at once. Windows burst open and the candles die.</li>
    <li>Telephones ring in empty rooms. The radio finds a voice. A baby cries in the nursery.</li>
    <li>Footsteps cross the floor above you. Something breathes on your neck.</li>
    <li>Words appear on the walls. A shape crosses a doorway at the end of the hall.</li></ul>
    <h4>Side quests</h4>
    <p>The house offers bargains. Scattered diary pages, hidden stashes, a prayer at the chapel altar, a lullaby, a last chord on the piano —
    finish them for supplies, protection, or the location of a key. Active quests show under your objectives.</p>` },
  { id: 'survive', tab: 'Survival', title: 'Staying alive', photo: { prop: ['items', 'Battery'] }, body: `
    <ul><li>Sprinting is loud. Walk when you can, crouch when they are near.</li>
    <li>Slide (<kbd>C</kbd> while sprinting) for a burst of speed. It costs stamina.</li>
    <li>Closing a door behind you breaks their line of sight — the Warden will break it anyway.</li>
    <li>When caught you lose a life. When the lives run out, you watch.</li>
    <li><b>Voice chat is in the house too</b>: they can hear you talk. Whisper.</li></ul>
    <h4>Keys</h4>
    <p><kbd>B</kbd> guide · <kbd>U</kbd> free cursor · <kbd>M</kbd> mute mic · <kbd>V</kbd> push-to-talk · <kbd>Tab</kbd> map · <kbd>Esc</kbd> pause</p>` },
];

export class Guide {
  constructor(onClose) {
    this.onClose = onClose;
    this.el = document.getElementById('guide');
    this.open = false;
    this.photos = {};
    this.page = 0;
    this.el.querySelector('.g-tabs').innerHTML = CH.map((c, i) => `<button data-i="${i}" style="--i:${i}">${c.tab}</button>`).join('');
    this.el.querySelectorAll('.g-tabs button').forEach((b) => b.addEventListener('click', () => this.show(+b.dataset.i)));
    this.el.querySelector('.g-close').addEventListener('click', () => this.close());
    this.el.querySelector('.g-prev').addEventListener('click', () => this.show(Math.max(0, this.page - 1)));
    this.el.querySelector('.g-next').addEventListener('click', () => this.show(Math.min(CH.length - 1, this.page + 1)));
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  async photo(spec) {
    const key = JSON.stringify(spec);
    if (this.photos[key] !== undefined) return this.photos[key];
    if (!this.stage) { const c = document.createElement('canvas'); c.width = 400; c.height = 300; this.stage = new CharStage(c); }
    let url = null;
    try { url = spec.ghost ? await this.stage.ghostPortrait(spec.ghost, 360, 440) : this.stage.propPhoto(spec.prop[0], spec.prop[1], 380, 280); } catch (_) { url = null; }
    this.photos[key] = url;
    return url;
  }

  async show(i) {
    const turn = i !== this.page;
    this.page = i;
    const c = CH[i];
    this.el.querySelectorAll('.g-tabs button').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    const L = this.el.querySelector('.g-left'), R = this.el.querySelector('.g-right');
    if (turn) { audio.play('page'); this.el.querySelector('.g-book').classList.remove('turn'); void this.el.offsetWidth; this.el.querySelector('.g-book').classList.add('turn'); }
    L.innerHTML = `<h2>${c.title}</h2><div class="g-text">${c.body}</div><span class="g-num">${i * 2 + 1}</span>`;
    R.innerHTML = `<figure class="g-photo"><div class="g-ph-wait">developing…</div><figcaption>${c.title}</figcaption></figure>${c.photo2 ? '<figure class="g-photo small"><div class="g-ph-wait">…</div></figure>' : ''}<span class="g-num">${i * 2 + 2}</span>`;
    const figs = R.querySelectorAll('figure');
    const fill = async (fig, spec, cap) => {
      const url = await this.photo(spec);
      if (this.page !== i) return;
      fig.querySelector('.g-ph-wait').outerHTML = url ? `<img alt="${cap}" src="${url}">` : '<div class="g-ph-wait">the photograph is ruined</div>';
    };
    fill(figs[0], c.photo, c.title);
    if (c.photo2 && figs[1]) fill(figs[1], c.photo2, '');
  }

  toggle() { if (this.open) this.close(); else this.show_(); }
  show_() {
    this.open = true;
    this.el.classList.add('on');
    audio.play('book_open');
    this.show(this.page);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    audio.play('page', { vol: 0.6 });
    this.onClose?.();
  }
}

let single = null;
/** One guide per page (the DOM is shared between games); the close callback follows the current game. */
export function getGuide(onClose) {
  if (!single) single = new Guide(onClose);
  single.onClose = onClose;
  return single;
}
