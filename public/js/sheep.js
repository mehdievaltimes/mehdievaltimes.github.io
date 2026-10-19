// A small flock that wanders the page. Sheep start every visit at home, parked off-screen.
// Letting them out lasts for this tab's session, and the flock keeps its place between pages.
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('call-sheep-home');
    // Respect people who asked their OS for less motion: no roaming sheep for them.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (button) button.remove();
        return;
    }

    const COUNT = 15;
    const W = 60, H = 50;
    // Speeds in px per second, so the flock moves the same on 60 Hz and 120 Hz screens.
    const WANDER = () => 24 + Math.random() * 24;
    const TROT = () => 100 + Math.random() * 50;
    const RUN = () => 900 + Math.random() * 300;
    const GRAZE_RATE = 0.12; // grazing breaks per second of walking
    const FLOCK_KEY = 'sheepFlock';
    const BAAS = Array.from({ length: 12 }, (_, i) => `/audio/baa-${i + 1}.mp3`);
    let lastBaa = -1;

    const style = document.createElement('style');
    style.textContent = `
      .sheep { position: fixed; left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 9999; user-select: none; touch-action: none; cursor: grab; }
      .sheep.dragging { cursor: grabbing; }
      .sheep.away { pointer-events: none; cursor: default; }
      .sheep svg { display: block; overflow: visible; }
      .sheep.hop svg { animation: sheep-hop .2s ease-out; }
      /* The black face and legs vanish on a dark background; a soft light rim keeps them visible. */
      :root:not([data-theme='light']) .sheep svg { filter: drop-shadow(0 0 1.5px rgba(214, 222, 235, .6)); }
      .sheep .leg { transform-origin: 50% 10%; animation: sheep-walk var(--step, .5s) infinite alternate ease-in-out; animation-play-state: var(--legs, running); }
      .sheep .leg.b { animation-direction: alternate-reverse; }
      .sheep .head { transform-origin: 80% 50%; transition: transform .5s; }
      .sheep .head.graze { animation: sheep-graze 4s infinite; }
      .sheep .head.sad { transform: rotate(20deg) translate(-2px, 4px); }
      .sheep .ear { transform-origin: center; transition: transform .5s; }
      .sheep .head.sad .ear { transform: rotate(50deg); }
      .sheep .eye { transition: clip-path .5s; }
      .sheep .head.sad .eye { clip-path: polygon(0 50%, 100% 50%, 100% 100%, 0 100%); }
      @keyframes sheep-walk { from { transform: rotate(-15deg); } to { transform: rotate(15deg); } }
      @keyframes sheep-graze { 0%, 100% { transform: rotate(0); } 10%, 40% { transform: rotate(30deg) translate(-2px, 5px); } 50%, 90% { transform: rotate(0); } }
      @keyframes sheep-hop { 50% { transform: translateY(-20px); } }
    `;
    document.head.appendChild(style);

    const svg = `
    <svg width="${W}" height="${H}" viewBox="0 0 60 50" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect class="leg" x="15" y="30" width="4" height="15" rx="2" fill="#333"/>
      <rect class="leg b" x="25" y="30" width="4" height="15" rx="2" fill="#333"/>
      <rect class="leg" x="35" y="30" width="4" height="15" rx="2" fill="#333"/>
      <rect class="leg b" x="45" y="30" width="4" height="15" rx="2" fill="#333"/>
      <path d="M 15 25 C 10 25, 10 15, 20 15 C 25 5, 40 5, 45 15 C 55 15, 55 25, 50 25 C 55 35, 45 40, 35 35 C 30 40, 20 40, 15 35 C 5 35, 5 25, 15 25 Z" fill="#fdfdfd" stroke="#dcdcdc" stroke-width="2"/>
      <g class="head">
        <ellipse cx="50" cy="20" rx="8" ry="10" fill="#222"/>
        <ellipse class="ear" cx="43" cy="17" rx="5" ry="2.5" fill="#222" transform="rotate(20 43 17)"/>
        <circle class="eye" cx="53" cy="18" r="1.5" fill="#fff"/>
      </g>
    </svg>`;

    let out = false;
    let saved = null;
    try {
        localStorage.removeItem('sheepAreHome'); // from an older version
        out = sessionStorage.getItem('sheepAreOut') === 'true';
        saved = out ? JSON.parse(sessionStorage.getItem(FLOCK_KEY) || 'null') : null;
    } catch {}

    const homeX = (side) => (side === 'left' ? -W - 40 : innerWidth + 40);
    const maxY = () => Math.max(0, innerHeight - H);

    // Modes: home (parked off-screen at `side`), leaving (running to `side`), entering (trotting
    // in to `target`), wander, graze, drag.
    function makeSheep(init) {
        const el = document.createElement('div');
        el.className = 'sheep';
        el.innerHTML = svg;
        document.body.appendChild(el);
        const s = {
            el, head: el.querySelector('.head'),
            side: Math.random() < 0.5 ? 'left' : 'right',
            y: Math.random() * maxY(), dir: 1, speed: WANDER(), mode: 'home',
            target: 0, timer: null, grazeUntil: 0, drag: null,
            ...init,
        };
        if (s.x === undefined) s.x = homeX(s.side);
        setMode(s, s.mode);
        draw(s);
        listen(s);
        return s;
    }

    function setMode(s, mode) {
        s.mode = mode;
        const legs = { home: 'paused', graze: 'paused', drag: 'running' }[mode] ?? 'running';
        const step = { leaving: '.1s', entering: '.3s', drag: '.15s' }[mode] ?? '.5s';
        s.el.style.setProperty('--legs', legs);
        s.el.style.setProperty('--step', step);
        s.head.classList.toggle('sad', mode === 'home' || mode === 'leaving');
        s.head.classList.toggle('graze', mode === 'graze');
        s.el.classList.toggle('away', mode === 'home' || mode === 'leaving');
        s.el.classList.toggle('dragging', mode === 'drag');
    }

    function draw(s) {
        s.el.style.transform = `translate(${s.x}px, ${s.y}px) scaleX(${s.dir})`;
    }

    function leave(s) {
        clearTimeout(s.timer);
        s.side = s.x + W / 2 > innerWidth / 2 ? 'right' : 'left';
        s.dir = s.side === 'right' ? 1 : -1;
        s.speed = RUN();
        setMode(s, 'leaving');
    }

    function enter(s, delay) {
        clearTimeout(s.timer);
        s.timer = setTimeout(() => {
            if (s.mode !== 'home' && s.mode !== 'leaving') return;
            if (s.mode === 'leaving' && s.x > -W && s.x < innerWidth) {
                // Caught on the way home: turn back to wandering where it is.
                s.speed = WANDER();
                return setMode(s, 'wander');
            }
            // Start from just past the edge it's parked at, wherever that is after a resize.
            s.x = homeX(s.side);
            const margin = Math.min(120, innerWidth / 4);
            s.target = margin + Math.random() * Math.max(0, innerWidth - W - 2 * margin);
            s.dir = s.x < s.target ? 1 : -1;
            s.speed = TROT();
            setMode(s, 'entering');
        }, delay);
    }

    function step(s, dt, now) {
        if (s.mode === 'home' || s.mode === 'drag') return;
        if (s.mode === 'graze') {
            if (now < s.grazeUntil) return;
            if (Math.random() < 0.5) s.dir *= -1;
            return setMode(s, 'wander');
        }
        s.x += s.speed * s.dir * dt;
        if (s.mode === 'leaving') {
            const end = homeX(s.side);
            if ((s.dir === 1 && s.x >= end) || (s.dir === -1 && s.x <= end)) { s.x = end; setMode(s, 'home'); }
        } else if (s.mode === 'entering') {
            if ((s.dir === 1 && s.x >= s.target) || (s.dir === -1 && s.x <= s.target)) { s.speed = WANDER(); setMode(s, 'wander'); }
        } else {
            // Walk off one side, come back in from the other.
            if (s.x > innerWidth + 10) s.x = -W - 10;
            else if (s.x < -W - 10) s.x = innerWidth + 10;
            if (Math.random() < GRAZE_RATE * dt) { s.grazeUntil = now + 3000 + Math.random() * 4000; setMode(s, 'graze'); }
        }
        draw(s);
    }

    function listen(s) {
        s.el.addEventListener('pointerdown', (e) => {
            if (s.mode === 'home' || s.mode === 'leaving') return;
            s.el.setPointerCapture(e.pointerId);
            s.drag = { dx: e.clientX - s.x, dy: e.clientY - s.y, x0: e.clientX, y0: e.clientY, moved: false, prev: s.mode };
            setMode(s, 'drag');
            e.preventDefault();
        });
        s.el.addEventListener('pointermove', (e) => {
            if (!s.drag) return;
            if (Math.abs(e.clientX - s.drag.x0) + Math.abs(e.clientY - s.drag.y0) > 4) s.drag.moved = true;
            s.x = e.clientX - s.drag.dx;
            s.y = Math.min(maxY(), Math.max(0, e.clientY - s.drag.dy));
            draw(s);
        });
        const release = () => {
            if (!s.drag) return;
            const { moved } = s.drag;
            s.drag = null;
            if (s.mode !== 'drag') return; // sent home mid-drag
            s.speed = WANDER();
            setMode(s, 'wander');
            if (!moved) baa(s);
        };
        s.el.addEventListener('pointerup', release);
        s.el.addEventListener('pointercancel', release);
    }

    function baa(s) {
        s.el.classList.remove('hop');
        void s.el.offsetWidth; // restart the hop if it's mid-air
        s.el.classList.add('hop');
        // A random bleat, never the same one twice in a row; a new element each time so they can overlap.
        let pick = Math.floor(Math.random() * (BAAS.length - 1));
        if (pick >= lastBaa) pick++;
        lastBaa = pick;
        const clip = new Audio(BAAS[pick]);
        clip.volume = 0.8;
        clip.play().catch(() => {});
    }

    // Build the flock. If it was out on the previous page, put each sheep back where it was.
    const flock = Array.from({ length: COUNT }, (_, i) => {
        const prev = saved?.[i];
        if (!prev || prev.away) return makeSheep(prev ? { y: Math.min(prev.y, maxY()), side: prev.side } : {});
        const entering = prev.target !== undefined;
        return makeSheep({ x: prev.x, y: Math.min(prev.y, maxY()), dir: prev.dir, side: prev.side,
            mode: entering ? 'entering' : 'wander', target: prev.target ?? 0, speed: entering ? TROT() : WANDER() });
    });
    if (out) flock.forEach((s, i) => { if (s.mode === 'home') enter(s, i * 450 + Math.random() * 400); });

    let last = performance.now();
    requestAnimationFrame(function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000); // a background tab shouldn't teleport the flock
        last = now;
        for (const s of flock) step(s, dt, now);
        requestAnimationFrame(frame);
    });

    addEventListener('resize', () => {
        for (const s of flock) {
            s.y = Math.min(s.y, maxY());
            if (s.mode === 'home') s.x = homeX(s.side);
            draw(s);
        }
    });

    addEventListener('pagehide', () => {
        try {
            if (!out) return sessionStorage.removeItem(FLOCK_KEY);
            // A sheep on its way in keeps walking in on the next page; one that hasn't set off yet starts then.
            sessionStorage.setItem(FLOCK_KEY, JSON.stringify(flock.map((s) => (
                s.mode === 'home' || s.mode === 'leaving' ? { away: true, y: s.y, side: s.side }
                    : { x: s.x, y: s.y, dir: s.dir, side: s.side, ...(s.mode === 'entering' && { target: s.target }) }))));
        } catch {}
    });

    function label() {
        if (button) button.textContent = out ? 'send the sheep home' : 'let the sheep out';
    }
    label();

    window.toggleSheepHome = () => {
        out = !out;
        try { sessionStorage.setItem('sheepAreOut', String(out)); } catch {}
        label();
        // One at a time, in a loose order, so they trickle out instead of appearing together.
        flock.forEach((s, i) => (out ? enter(s, i * 450 + Math.random() * 400) : leave(s)));
    };
});
