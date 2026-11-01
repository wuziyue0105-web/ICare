// Campus Wellbeing — the page side.
// Every score, recommendation and saved file comes from the Python server (web_app.py).

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const menuButton = document.querySelector('.menu-button');

const state = {
  meta: null,
  username: null,    // typed or signed-in username
  creating: false,   // showing Create account instead of Sign in
  user: null,        // saved user from the server
  isNew: false,
  view: 'signin',
  step: 0,           // check-in part, 0-3
  answers: null,
  card: null,
  recs: [],
  earlier: 0,
  ratings: {},
  saved: false,
  error: '',
};

const PARTS = [
  { key: 'pss', title: 'Stress', about: 'PSS-4, about the last month' },
  { key: 'who', title: 'Mood', about: 'WHO-5, over the last two weeks' },
  { key: 'ucla', title: 'Belonging', about: 'UCLA Loneliness Scale, 3 items' },
  { key: 'today', title: 'Today', about: 'Your energy, confidence and free days' },
];
const RATINGS = [[1, 'Not for me'], [2, 'Okay'], [3, 'Loved it']];
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

// ---------- helpers ----------

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function title(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function sentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new Error('Could not reach the app. Is web_app.py still running?');
  }
  const data = await response.json();
  if (response.status === 401) {
    clearUser();
    state.view = 'signin';
  }
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function choicePills(name, choices, picked, type = 'radio', extraClass = '') {
  const pills = choices.map(([value, words]) => {
    const checked = type === 'radio' ? picked === value : picked.includes(value);
    return `<label class="choice"><input type="${type}" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}><span>${esc(words)}</span></label>`;
  }).join('');
  return `<div class="choices ${extraClass}" role="${type === 'radio' ? 'radiogroup' : 'group'}">${pills}</div>`;
}

function show(viewName) {
  state.view = viewName;
  state.error = '';
  render();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  nav.classList.add('closed');
  menuButton.setAttribute('aria-expanded', 'false');
}

// ---------- pieces shared by the views ----------
// Every page opens on bare paper: the title on the left, one ink painting on the right.
// The paintings come from ink.js.

// A painting. Hidden from screen readers: it is decoration.
function inkArt(name) {
  return `<div class="ink-art" data-art="${name}" aria-hidden="true"><div class="painting"></div></div>`;
}

// The page title. extra is optional HTML under the lede.
function hero(heading, lede, art = null, extra = '', compact = false) {
  return `
    <header class="hero span-12${compact ? ' compact' : ''}${art ? '' : ' plain'}">
      <div class="hero-text">
        <h1>${heading}</h1>
        ${lede ? `<p class="lede">${lede}</p>` : ''}
        ${extra}
      </div>
      ${art ? inkArt(art) : ''}
    </header>`;
}

// ---------- views ----------

function authForm() {
  const creating = state.creating;
  return `
    <form id="auth-form" novalidate>
      <h2>${creating ? 'Create an account' : 'Sign in'}</h2>
      <div class="field">
        <label for="username">Username</label>
        <input class="input" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(state.username || '')}">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input class="input" id="password" name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}"${creating ? ' aria-describedby="password-hint"' : ''}>
        ${creating ? '<p class="hint" id="password-hint">8+ characters. It cannot be recovered.</p>' : ''}
      </div>
      <p class="form-error" role="alert">${esc(state.error)}</p>
      <div class="actions">
        <button class="button primary" type="submit">${creating ? 'Create account' : 'Sign in'}</button>
        <button class="text-button" type="button" data-action="toggle-auth">${creating ? 'I have an account' : 'New here? Create account'}</button>
      </div>
    </form>`;
}

function signinView() {
  return `
  <div class="page signin">
    <div class="span-7 signin-left">
      ${hero('How are you, really?', 'Two minutes. Three events picked for your week.')}
      ${inkArt('bird')}
    </div>
    <div class="span-5 signin-right">
      ${authForm()}
      <section aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol class="journey">
          <li>Answer 14 questions</li>
          <li>See your scores</li>
          <li>Rate 3 USU events</li>
        </ol>
      </section>
    </div>
  </div>`;
}

function lastCheckinLine(user) {
  if (user.checkins.length === 0) return 'No check-ins yet. Ready for your first?';
  const last = user.checkins[user.checkins.length - 1];
  return `Last time (${esc(last.date)}): stress ${last.stress}/16, mood ${last.mood}/100.`;
}

function welcomeView() {
  const user = state.user;
  const rated = Object.keys(user.ratings).length;
  const learnedTags = Object.keys(user.learned).filter((tag) => user.learned[tag] !== 0).length;
  return `
  <div class="page">
    ${hero(`${greeting()}, ${esc(title(user.name))}.`, lastCheckinLine(user), 'lotus')}
    <section class="span-8" aria-labelledby="start">
      <div class="panel-head"><h2 id="start">Today’s check-in</h2><span class="meta">About 2 minutes</span></div>
      <ol class="parts">${PARTS.map((p) => `<li>${esc(p.title)}</li>`).join('')}</ol>
      <div class="actions">
        <button class="button primary big" type="button" data-action="start">Start check-in</button>
        <button class="button secondary" type="button" data-go="profile">Update profile</button>
      </div>
    </section>
    <section class="span-8 so-far" aria-labelledby="so-far">
      <h2 id="so-far">So far</h2>
      <dl class="medals num">
        <div><dd>${user.checkins.length}</dd><dt>Check-ins</dt></div>
        <div><dd>${rated}</dd><dt>Events rated</dt></div>
        <div><dd>${learnedTags}</dd><dt>Tags learned</dt></div>
        <div><dd class="word">${esc(title(user.personality))}</dd><dt>Recharges by</dt></div>
      </dl>
    </section>
  </div>`;
}

function profileView() {
  const user = state.user || { name: '', personality: null, interests: [], setting: null, atmosphere: null };
  const personality = [['introvert', 'Time alone'], ['ambivert', 'It depends'], ['extrovert', 'A group outing']];
  const interests = state.meta.interests.map((tag) => [tag, title(tag)]);
  const lede = state.isNew ? 'Asked once. You can change these later.' : 'Your history and ratings are kept.';
  return `
  <div class="page">
    ${hero(state.isNew ? 'About you' : 'Your profile', lede)}
    <form id="profile-form" class="span-12 profile-grid" novalidate>
      <div class="q-card span-5">
        <h2><label for="name">What should we call you?</label></h2>
        <input class="input" id="name" name="name" autocomplete="given-name" maxlength="40" value="${esc(user.name)}">
      </div>
      <div class="q-card span-7">
        <h2>After a busy week, what recharges you?</h2>
        ${choicePills('personality', personality, user.personality)}
      </div>
      <div class="q-card span-12">
        <h2>What do you enjoy? <span class="tag-note">At least one</span></h2>
        ${choicePills('interests', interests, user.interests, 'checkbox')}
      </div>
      <div class="q-card span-6">
        <h2>Indoor or outdoor?</h2>
        ${choicePills('setting', [['indoor', 'Indoor'], ['outdoor', 'Outdoor'], ['either', 'Either']], user.setting)}
      </div>
      <div class="q-card span-6">
        <h2>Quiet or active?</h2>
        ${choicePills('atmosphere', [['quiet', 'Quiet'], ['active', 'Active'], ['either', 'Either']], user.atmosphere)}
      </div>
      <div class="span-12 form-foot">
        <div class="actions">
          <button class="button primary" type="submit">Save profile</button>
          ${state.isNew
            ? '<button class="button secondary" type="button" data-action="signout">Sign out</button>'
            : '<button class="button secondary" type="button" data-go="back">Cancel</button>'}
        </div>
        <p class="form-error" role="alert">${esc(state.error)}</p>
      </div>
    </form>
  </div>`;
}

function stepper() {
  return `<ol class="stepper span-12" aria-label="Check-in progress">${PARTS.map((part, i) => {
    const cls = i < state.step ? 'done' : (i === state.step ? 'now' : '');
    return `<li class="${cls}"${i === state.step ? ' aria-current="step"' : ''} title="${esc(part.about)}"><span>${esc(part.title)}</span></li>`;
  }).join('')}</ol>`;
}

// One question card. ends = [low, high] labels shown under a 1-10 row.
function questionCard(n, text, pills, ends = null) {
  const endRow = ends ? `<div class="ends small"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : '';
  return `<div class="question"><span class="qn num">${n}</span><div class="q-body"><p>${text}</p>${pills}${endRow}</div></div>`;
}

function checkinView() {
  const part = PARTS[state.step];
  let body;
  if (part.key === 'today') {
    const tens = [];
    for (let i = 1; i <= 10; i++) tens.push([i, String(i)]);
    const days = state.meta.days.map((d) => [d, d]);
    body = [
      questionCard(1, 'How much energy do you have for being around people today?',
        choicePills('energy', tens, state.answers.energy, 'radio', 'numbers'), ['None', 'Plenty']),
      questionCard(2, 'How confident do you feel in yourself right now?',
        choicePills('confidence', tens, state.answers.confidence, 'radio', 'numbers'), ['Not at all', 'Very']),
      questionCard(3, 'Which days are you free this week?',
        `${choicePills('days', days, state.answers.days, 'checkbox')}<button class="text-button" type="button" data-action="all-days">Every day</button>`),
    ].join('');
  } else {
    const scale = state.meta[part.key];
    body = scale.questions.map((q, i) => questionCard(i + 1, esc(q),
      choicePills(part.key + '-' + i, scale.choices, state.answers[part.key][i]))).join('');
  }
  const last = state.step === PARTS.length - 1;
  return `
  <div class="page">
    ${hero('Check-in', `<strong>${esc(part.title)}</strong>, part ${state.step + 1} of ${PARTS.length}`, 'fish', '', true)}
    ${stepper()}
    <form id="checkin-form" class="span-12" novalidate>
      <div class="question-list">${body}</div>
      <p class="form-error" role="alert">${esc(state.error)}</p>
      <div class="actions">
        <button class="button primary" type="submit">${last ? 'See my results' : 'Continue'}</button>
        <button class="button secondary" type="button" data-action="${state.step === 0 ? 'cancel-checkin' : 'back-step'}">${state.step === 0 ? 'Cancel' : 'Back'}</button>
      </div>
    </form>
  </div>`;
}

function track(row) {
  const span = row.high - row.low;
  const pos = ((row.value - row.low) / span) * 100;
  const cuts = row.cuts.map((c) => `<span class="cut" style="left:${((c + 0.5 - row.low) / span) * 100}%"></span>`).join('');
  return `
    <div class="track" aria-hidden="true">
      <span class="line"></span><span class="fill" style="width:${pos}%"></span>${cuts}
      <span class="dot" style="left:${pos}%"></span>
    </div>
    <div class="track-ends num"><span>${row.low}</span><span>${row.high}</span></div>`;
}

// A score tile. The longer meaning is kept in the tooltip so the tile reads at a glance.
function tile(row) {
  const alert = (row.key === 'stress' && row.value >= 12) || (row.key === 'mood' && row.value <= 28);
  return `
  <section class="span-3 tile" title="${esc(row.meaning)}" aria-label="${esc(row.label)} ${row.value} out of ${row.high}, ${esc(row.verdict)}">
    <span class="label">${esc(row.label)}</span>
    <span class="value num">${row.value}<span class="of"> /${row.high}</span></span>
    <span class="verdict${alert ? ' alert' : ''}">${esc(row.verdict)}</span>
    ${track(row)}
  </section>`;
}

function recCard(rec, i) {
  const rating = state.ratings[rec.name] || null;
  const more = rec.more_sessions > 0 ? ` (+${rec.more_sessions} more)` : '';
  const rate = state.saved
    ? `<div class="rate"><span class="q">You said</span><span>${esc(RATINGS[rating - 1][1])}</span></div>`
    : `<fieldset class="rate"><legend class="q">Did this suit you?</legend>${choicePills('rate-' + i, RATINGS, rating)}</fieldset>`;
  // Two reasons show; any others fold away.
  const reasons = rec.reasons.map((r) => `<li>${esc(sentence(r))}</li>`);
  const why = `<ul class="why">${reasons.slice(0, 2).join('')}</ul>${reasons.length > 2
    ? `<details class="more"><summary>More reasons</summary><ul class="why">${reasons.slice(2).join('')}</ul></details>` : ''}`;
  return `
  <article class="rec">
    <div class="rec-main">
      <h3><a href="${esc(rec.link)}" target="_blank" rel="noopener">${esc(rec.name)}</a></h3>
      <span class="club">${esc(rec.club)}</span>
      <div class="facts"><span>${esc(rec.when)}${esc(more)}</span><span>${esc(rec.location)}</span><span>${esc(rec.price)}</span></div>
    </div>
    <div class="score"><b class="num">${rec.score}</b><span>match</span></div>
    <div class="rec-why">${why}</div>
    ${rate}
  </article>`;
}

function changesBlock(card) {
  if (card.changes.length === 0) {
    return `<div class="rail-block"><h2>Since last time</h2><p class="small">First check-in, nothing to compare yet.</p></div>`;
  }
  const rows = card.changes.map((c) => {
    const sign = c.diff > 0 ? '+' : (c.diff < 0 ? '−' : '±');
    const cls = c.diff === 0 ? 'same' : (c.better ? 'up' : 'down');
    return `<div><dt>${esc(c.label)}</dt><dd class="${cls}">${sign}${Math.abs(c.diff)}</dd></div>`;
  }).join('');
  return `<div class="rail-block"><h2>Since ${esc(card.before_date)}</h2><dl class="kv num">${rows}</dl></div>`;
}

function todayView() {
  const card = state.card;
  const energy = card.rows.find((r) => r.key === 'energy');
  const tiles = card.rows.filter((r) => r.key !== 'energy').map((r) => tile(r)).join('');
  const support = card.support ? `
    <aside class="notice span-12" role="note" aria-label="Support">
      <p><b>Your answers suggest things feel heavy right now.</b> Talking to someone can really help.</p>
      <div class="contacts">
        <a href="${esc(card.support_link)}" target="_blank" rel="noopener">USyd Counselling and Mental Health Support</a>
        <a href="tel:131114">Lifeline 13 11 14 (24/7)</a>
      </div>
    </aside>` : '';
  const recs = state.recs.length === 0
    ? `<div class="empty">No event matches this time. Try more free days or interests.
         <div class="actions"><button class="button secondary" type="button" data-action="redo-days">Change free days</button></div></div>`
    : `<div class="recs">${state.recs.map(recCard).join('')}</div>`;
  const allRated = state.recs.every((r) => state.ratings[r.name]);
  const save = state.recs.length === 0 ? '' : (state.saved
    ? `<div class="save-row"><span>Saved. Next suggestions will use these.</span><button class="button secondary" type="button" data-go="learned">See what it learned</button></div>`
    : `<div class="save-row"><span class="muted" id="save-hint">${allRated ? 'All three rated.' : 'Rate all three to save.'}</span>
         <button class="button primary" type="button" data-action="save-ratings" aria-describedby="save-hint"${allRated ? '' : ' aria-disabled="true"'}>Save ratings</button></div>
       <p class="form-error" role="alert">${esc(state.error)}</p>`);
  const days = card.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
  const meta = state.earlier > 0 ? `Uses your ${state.earlier} earlier ratings` : 'Your ratings shape the next ones';

  return `
  <div class="page">
    ${hero(`${greeting()}, ${esc(title(state.user.name))}.`, `<strong>${esc(sentence(card.focus_text))}</strong>`, 'lotus',
      `<span class="stamp num">${esc(card.date)}</span>`)}
    ${support}
    ${tiles}
    <section class="span-8" aria-labelledby="recs-title">
      <div class="panel-head"><h2 id="recs-title">Suggested USU events</h2><span class="meta">${esc(meta)}</span></div>
      ${recs}
      ${save}
    </section>
    <aside class="span-4 rail">
      <div class="rail-block">
        <h2>Social energy</h2>
        <span class="big-num num">${energy.value}<span class="of"> /10</span></span>
        <p>${esc(card.size === 'large' ? 'Large' : title(card.size))} groups today</p>
      </div>
      ${changesBlock(card)}
      <div class="rail-block">
        <h2>Free this week</h2>
        <p>${esc(days)}</p>
        <button class="text-button" type="button" data-action="start">Check in again</button>
      </div>
    </aside>
  </div>`;
}

function learnedView() {
  const user = state.user;
  const tags = state.meta.interests.slice().sort((a, b) => (user.learned[b] || 0) - (user.learned[a] || 0));
  const rows = tags.map((tag) => {
    const v = user.learned[tag] || 0;
    const width = (Math.abs(v) / 3) * 100;
    const sign = v > 0 ? '+' : (v < 0 ? '−' : '');
    return `<div class="weight${v === 0 ? ' zero' : ''}" role="listitem" aria-label="${esc(tag)} ${v}">
      <span class="tag">${esc(title(tag))}</span>
      <span class="neg">${v < 0 ? `<i style="width:${width}%"></i>` : ''}</span>
      <span class="pos">${v > 0 ? `<i style="width:${width}%"></i>` : ''}</span>
      <span class="val num">${sign}${Math.abs(v)}</span></div>`;
  }).join('');
  const names = Object.keys(user.ratings);
  const rated = names.length === 0
    ? '<p class="empty">Nothing rated yet. Rate today’s three suggestions to start.</p>'
    : `<ul class="rated">${names.map((n) => `<li><span>${esc(n)}</span><span class="r r${user.ratings[n]}">${esc(RATINGS[user.ratings[n] - 1][1])}</span></li>`).join('')}</ul>`;
  return `
  <div class="page">
    ${hero('What it has learned', 'Your ratings nudge each tag from −3 to +3.', 'orchid')}
    <section class="span-7" aria-labelledby="w-title">
      <div class="panel-head"><h2 id="w-title">Tag weights</h2><span class="meta">${names.length} ratings</span></div>
      <div class="weights num" role="list">${rows}</div>
      <div class="axis num" aria-hidden="true"><span></span><span><span>−3</span><span></span></span><span><span>0</span><span>+3</span></span><span></span></div>
    </section>
    <section class="span-5 rated-block" aria-labelledby="r-title">
      <div class="panel-head"><h2 id="r-title">Rated events</h2><span class="meta">Not suggested again</span></div>
      ${rated}
    </section>
  </div>`;
}

const VIEWS = { signin: signinView, welcome: welcomeView, profile: profileView, checkin: checkinView, today: todayView, learned: learnedView };

// ---------- render and shell ----------

function render() {
  view.innerHTML = VIEWS[state.view]();
  Ink.mount(view);   // decoration: put the finished paintings into the new page
  const signedIn = Boolean(state.user);
  nav.hidden = !signedIn;
  menuButton.hidden = !signedIn;
  document.querySelector('.who').hidden = !signedIn;
  if (signedIn) {
    document.querySelector('.who-name').textContent = title(state.user.name);
    document.querySelector('.avatar').textContent = state.user.name.charAt(0).toUpperCase();
  }
  const current = { welcome: 'today', today: 'today', checkin: 'today', profile: 'profile', learned: 'learned' }[state.view];
  nav.querySelectorAll('a').forEach((a) => {
    if (a.dataset.view === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function newAnswers() {
  return {
    pss: Array(state.meta.pss.questions.length).fill(null),
    who: Array(state.meta.who.questions.length).fill(null),
    ucla: Array(state.meta.ucla.questions.length).fill(null),
    energy: null, confidence: null, days: [],
  };
}

function goToday() {
  show(state.card ? 'today' : 'welcome');
}

// ---------- events ----------

view.addEventListener('change', (event) => {
  const input = event.target;
  if (state.view === 'checkin') {
    const [key, index] = input.name.split('-');
    if (index !== undefined) state.answers[key][Number(index)] = Number(input.value);
    else if (key === 'energy' || key === 'confidence') state.answers[key] = Number(input.value);
    else if (key === 'days') {
      state.answers.days = [...view.querySelectorAll('input[name="days"]:checked')].map((i) => i.value);
    }
  } else if (state.view === 'today' && input.name.startsWith('rate-')) {
    const rec = state.recs[Number(input.name.split('-')[1])];
    state.ratings[rec.name] = Number(input.value);
    // Update only the save row, so focus stays on the pill just chosen.
    const allRated = state.recs.every((r) => state.ratings[r.name]);
    const button = view.querySelector('[data-action="save-ratings"]');
    if (allRated) button.removeAttribute('aria-disabled');
    document.getElementById('save-hint').textContent = allRated ? 'All three rated.' : 'Rate all three to save.';
  }
});

view.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'auth-form') {
      state.username = form.elements['username'].value;
      const data = await api(state.creating ? '/api/register' : '/api/login', {
        username: state.username, password: form.elements['password'].value,
      });
      state.username = data.username;
      state.isNew = data.is_new;
      state.user = data.user;
      state.card = null;
      show(data.is_new ? 'profile' : 'welcome');
    } else if (form.id === 'profile-form') {
      const picked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
      const one = (name) => picked(name)[0] || null;
      const data = await api('/api/profile', {
        name: form.elements['name'].value, personality: one('personality'), interests: picked('interests'),
        setting: one('setting'), atmosphere: one('atmosphere'),
      });
      const wasNew = state.isNew;
      state.user = data.user;
      state.isNew = false;
      if (wasNew) startCheckin(); else goToday();
    } else if (form.id === 'checkin-form') {
      await submitStep();
    }
  } catch (error) {
    state.error = error.message;
    render();
  }
});

function stepComplete() {
  const key = PARTS[state.step].key;
  const a = state.answers;
  if (key === 'today') {
    if (a.energy === null || a.confidence === null) return 'Please answer both questions.';
    if (a.days.length === 0) return 'Please choose at least one free day.';
    return '';
  }
  return a[key].includes(null) ? 'Please answer every question.' : '';
}

async function submitStep() {
  const problem = stepComplete();
  if (problem) {
    state.error = problem;
    render();
    return;
  }
  if (state.step < PARTS.length - 1) {
    state.step += 1;
    show('checkin');
    return;
  }
  const a = state.answers;
  const data = await api('/api/checkin', {
    pss: a.pss, who: a.who, ucla: a.ucla,
    energy: a.energy, confidence: a.confidence, days: a.days,
  });
  state.user = data.user;
  state.card = data.card;
  state.recs = data.recommendations;
  state.earlier = data.earlier_ratings;
  state.ratings = {};
  state.saved = false;
  show('today');
}

function startCheckin() {
  state.step = 0;
  state.answers = newAnswers();
  show('checkin');
}

view.addEventListener('click', async (event) => {
  const go = event.target.closest('[data-go]');
  if (go) {
    if (go.dataset.go === 'back') goToday();
    else show(go.dataset.go);
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'start') startCheckin();
  else if (name === 'back-step') { state.step -= 1; show('checkin'); }
  else if (name === 'cancel-checkin') goToday();
  else if (name === 'signout') signOut();
  else if (name === 'toggle-auth') {
    state.username = document.getElementById('username').value;
    state.creating = !state.creating;
    show('signin');
  }
  else if (name === 'all-days') {
    state.answers.days = state.meta.days.slice();
    render();
  } else if (name === 'redo-days') {
    state.step = PARTS.length - 1;
    show('checkin');
  } else if (name === 'save-ratings') {
    if (action.getAttribute('aria-disabled') === 'true') {
      state.error = 'Rate all three suggestions first.';
      render();
      return;
    }
    try {
      const data = await api('/api/feedback', { ratings: state.ratings });
      state.user = data.user;
      state.saved = true;
      state.error = '';
      render();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }
});

nav.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  if (link.dataset.view === 'today') goToday();
  else show(link.dataset.view);
});

menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('closed') === false;
  menuButton.setAttribute('aria-expanded', String(open));
});

function clearUser() {
  Object.assign(state, { username: null, creating: false, user: null, card: null, recs: [], ratings: {}, saved: false, isNew: false });
}

async function signOut() {
  await api('/api/signout', {}).catch(() => {});
  clearUser();
  show('signin');
}

document.querySelectorAll('.side [data-action="signout"]').forEach((button) => button.addEventListener('click', signOut));

// ---------- start ----------

(async function start() {
  Ink.preparePage();  // decoration: paint the dry-brush lines the stylesheet uses
  nav.classList.add('closed');
  try {
    state.meta = await api('/api/meta');
    // A refresh keeps the session, so pick up where the person was.
    const session = await api('/api/session');
    if (session.username) {
      state.username = session.username;
      state.isNew = session.is_new;
      state.user = session.user;
      state.view = session.is_new ? 'profile' : 'welcome';
    }
  } catch (error) {
    view.innerHTML = `<div class="page"><div class="title"><h1 class="sans">Campus Wellbeing</h1><p class="lede">${esc(error.message)} Start it with: python3 web_app.py</p></div></div>`;
    return;
  }
  render();
})();
