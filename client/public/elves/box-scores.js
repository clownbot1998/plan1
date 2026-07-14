// box-scores.js — a newspaper page, not a dashboard. Built off a real
// request (see /tmp/dad.txt): "all MLB games on one page, like the
// newspaper, only updated when I refresh — I don't want 15 tabs."
//
// Deliberately NOT sports-stats.js's shape: no room, no linkState, no
// broadcastElf, no receivers/transmitters. One fetch on load, one
// Refresh button, nothing else touches the network. That absence is the
// whole point of the ask — polling or realtime sync would be solving a
// problem nobody has here.
//
// Interoperable with sports-stats.js in the ways that actually matter
// for two independent standalone pages: same black/white/Courier New
// aesthetic, same MLB Stats API (CORS-confirmed, live, no vendoring —
// same schedule endpoint dad.txt names directly), same "team identity"
// shape. Not a shared room, not a shared entity model — a schedule/
// linescore is a game-level document, not a roster of sports-engine.js
// player/team entities, so it gets its own minimal shape here rather
// than forcing a fit that isn't real.
import { Self } from '@plan98/types'

const tag = 'box-scores'

function fmtDate(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function todayStr() { return fmtDate(new Date()) }

// off-days are real (this season's had one already) — flipping a day at
// a time is how a newspaper reader would actually get past one, not a
// reason to build live/in-progress handling for a page that explicitly
// doesn't want live updates.
function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  return fmtDate(dt)
}

const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.7
const ZOOM_MAX = 1.8

const $ = Self(tag, {
  date: todayStr(),
  games: null,    // null = not loaded yet; [] = loaded, no games that day
  loading: false,
  error: null,
  boxscores: {},  // { [gamePk]: data | 'loading' | 'error' } — always visible, no tap-to-open
  zoom: 1,        // local-only text-size multiplier — this elf's own root em, not the page's rem
})

function bumpZoom(delta) {
  const next = Math.round(($.learn().zoom + delta) * 100) / 100
  $.teach({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) })
}

// the deep per-player stat lines are a SECOND api call per game (dad.txt
// calls this out directly: "the linescore hydrate is usually enough...
// if you want deeper box scores later, add a second call per game using
// gamePk") — kicked off for every game as soon as the day's schedule
// loads, since the ask here is for batting/pitching to just be on the
// page, not behind a tap.
async function fetchBoxscore(gamePk) {
  if ($.learn().boxscores[gamePk] && $.learn().boxscores[gamePk] !== 'error') return
  $.teach({ boxscores: { ...$.learn().boxscores, [gamePk]: 'loading' } })
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
    const data = await res.json()
    $.teach({ boxscores: { ...$.learn().boxscores, [gamePk]: data } })
  } catch (e) {
    $.teach({ boxscores: { ...$.learn().boxscores, [gamePk]: 'error' } })
  }
}

async function loadGames() {
  const date = $.learn().date
  $.teach({ loading: true, error: null, boxscores: {} })
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`)
    const data = await res.json()
    const games = data.dates?.[0]?.games || []
    $.teach({ games, loading: false })
    // one boxscore fetch per game that's actually started — a Preview
    // game has no batting/pitching data to fetch yet.
    for (const g of games) {
      if ((g.linescore?.innings || []).length > 0) fetchBoxscore(g.gamePk)
    }
  } catch (e) {
    $.teach({ loading: false, error: e.message })
  }
}

loadGames()

function goToDate(dateStr) {
  $.teach({ date: dateStr, games: null })
  loadGames()
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

// real box scores show each game's own inning count (9, or extra
// innings) — not one shared column count forced across every game on
// the page, which is what a newspaper actually looks like.
function linescoreTable(game) {
  const ls = game.linescore
  const innings = ls?.innings || []
  const away = game.teams.away, home = game.teams.home
  const totals = ls?.teams || {}
  const cell = (side, i) => {
    const inn = innings[i]
    const v = inn?.[side]?.runs
    return v == null ? '' : v
  }
  return `
    <table class="bs-linescore">
      <thead>
        <tr>
          <th class="bs-team-col"></th>
          ${innings.map((_, i) => `<th>${i + 1}</th>`).join('')}
          <th class="bs-rhe">R</th><th class="bs-rhe">H</th><th class="bs-rhe">E</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="bs-team-col">${esc(away.team.abbreviation || away.team.teamCode?.toUpperCase() || away.team.name)}</td>
          ${innings.map((_, i) => `<td>${cell('away', i)}</td>`).join('')}
          <td class="bs-rhe">${totals.away?.runs ?? away.score ?? ''}</td>
          <td class="bs-rhe">${totals.away?.hits ?? ''}</td>
          <td class="bs-rhe">${totals.away?.errors ?? ''}</td>
        </tr>
        <tr>
          <td class="bs-team-col">${esc(home.team.abbreviation || home.team.teamCode?.toUpperCase() || home.team.name)}</td>
          ${innings.map((_, i) => `<td>${cell('home', i)}</td>`).join('')}
          <td class="bs-rhe">${totals.home?.runs ?? home.score ?? ''}</td>
          <td class="bs-rhe">${totals.home?.hits ?? ''}</td>
          <td class="bs-rhe">${totals.home?.errors ?? ''}</td>
        </tr>
      </tbody>
    </table>`
}

// a game with no innings played yet (Scheduled/Preview/Postponed) has no
// linescore worth rendering as a table — show the matchup and status
// instead, honestly, rather than an empty grid of dashes.
function statusLine(game) {
  const s = game.status
  if (s.abstractGameState === 'Preview') {
    const t = new Date(game.gameDate)
    return isNaN(t) ? s.detailedState : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  if (s.abstractGameState === 'Live') {
    const ls = game.linescore
    return `${ls?.inningState || ''} ${ls?.currentInningOrdinal || ''}`.trim() || s.detailedState
  }
  return s.detailedState
}

// standard AP-style newspaper box score, below the linescore: a batting
// table (AB R H RBI BB SO — the exact categories a 5x5 roto fantasy
// player already tracks per hitter) and a pitching table (IP H R ER BB
// K plus HR allowed, pitches thrown, and strikes thrown, plus the
// decision — same shape as ERA/WHIP/K/W-L roto categories, with the
// pitch-count columns for anyone tracking workload/efficiency), one of
// each per team, then a compact 2B/3B/HR/SB note line naming who did it.
// Skips attendance/weather/umpires on purpose — real newspaper box
// scores carry them, but they're not fantasy-relevant, and this whole
// feature is explicitly meant to stay a fast, minimal glance.
function battingTable(side, abbr) {
  const rows = (side.batters || [])
    .map(id => side.players[`ID${id}`])
    .filter(p => p && p.stats?.batting && Object.keys(p.stats.batting).length)
  const t = side.teamStats?.batting || {}
  return `
    <table class="bs-boxtable">
      <caption>${esc(abbr)} batting</caption>
      <thead><tr><th class="bs-name-col"></th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th></tr></thead>
      <tbody>
        ${rows.map(p => `
          <tr>
            <td class="bs-name-col" title="${esc(p.person.fullName)}">${esc(p.person.boxscoreName)} <span class="bs-pos">${esc(p.position.abbreviation)}</span></td>
            <td>${p.stats.batting.atBats ?? 0}</td>
            <td>${p.stats.batting.runs ?? 0}</td>
            <td>${p.stats.batting.hits ?? 0}</td>
            <td>${p.stats.batting.rbi ?? 0}</td>
            <td>${p.stats.batting.baseOnBalls ?? 0}</td>
            <td>${p.stats.batting.strikeOuts ?? 0}</td>
          </tr>`).join('')}
        <tr class="bs-totals">
          <td class="bs-name-col">Totals</td>
          <td>${t.atBats ?? ''}</td><td>${t.runs ?? ''}</td><td>${t.hits ?? ''}</td>
          <td>${t.rbi ?? ''}</td><td>${t.baseOnBalls ?? ''}</td><td>${t.strikeOuts ?? ''}</td>
        </tr>
      </tbody>
    </table>`
}

function pitchingTable(side, abbr) {
  const rows = (side.pitchers || [])
    .map(id => side.players[`ID${id}`])
    .filter(p => p && p.stats?.pitching && Object.keys(p.stats.pitching).length)
  return `
    <table class="bs-boxtable">
      <caption>${esc(abbr)} pitching</caption>
      <thead><tr><th class="bs-name-col"></th><th class="bs-ip-col">IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>HR</th><th>Pit</th><th>Str</th></tr></thead>
      <tbody>
        ${rows.map(p => `
          <tr>
            <td class="bs-name-col" title="${esc(p.person.fullName)}">${esc(p.person.boxscoreName)}${p.stats.pitching.note ? ` <span class="bs-decision">${esc(p.stats.pitching.note)}</span>` : ''}</td>
            <td>${p.stats.pitching.inningsPitched ?? ''}</td>
            <td>${p.stats.pitching.hits ?? 0}</td>
            <td>${p.stats.pitching.runs ?? 0}</td>
            <td>${p.stats.pitching.earnedRuns ?? 0}</td>
            <td>${p.stats.pitching.baseOnBalls ?? 0}</td>
            <td>${p.stats.pitching.strikeOuts ?? 0}</td>
            <td>${p.stats.pitching.homeRuns ?? 0}</td>
            <td>${p.stats.pitching.numberOfPitches ?? p.stats.pitching.pitchesThrown ?? ''}</td>
            <td>${p.stats.pitching.strikes ?? ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`
}

// classic box-score recap line — "2B: Yelich (MIL); HR: Suzuki (PIT)" —
// built from the same per-batter stats already rendered above, not a
// separate fetch. Lives in the recap, not as extra table columns — the
// batting table stays AB/R/H/RBI/BB/SO, the recap is where 2B/3B/HR/RBI/
// SB get named per player.
// one column per team, same bs-box-grid layout the batting/pitching
// tables already use — team is which column it's in, not a "(TEAM)"
// suffix repeated on every name.
function sideRecap(side, abbr) {
  const groups = [['doubles', '2B'], ['triples', '3B'], ['homeRuns', 'HR'], ['rbi', 'RBI'], ['stolenBases', 'SB']]
  const lines = groups.map(([statKey, label]) => {
    const names = []
    for (const id of side.batters || []) {
      const p = side.players[`ID${id}`]
      const n = p?.stats?.batting?.[statKey]
      if (n) {
        // season total (already inclusive of tonight's game) alongside
        // the name — real box scores do this for HR especially ("his
        // 14th of the season"), applied here to all five recap groups.
        const season = p?.seasonStats?.batting?.[statKey]
        names.push(`${p.person.boxscoreName}${n > 1 ? ` ${n}` : ''}${season != null ? ` (${season})` : ''}`)
      }
    }
    return names.length ? `<div><b>${label}:</b> ${names.map(esc).join(', ')}</div>` : ''
  }).filter(Boolean)
  return `
    <div class="bs-notes">
      <div class="bs-notes-caption">${esc(abbr)}</div>
      ${lines.length ? lines.join('') : '<div>—</div>'}
    </div>`
}

// team is the outer grouping, not stat-type — each column is one team's
// whole story (batting, recap, pitching) stacked together. Three separate
// away|home grids in sequence read fine on desktop (columns stay side by
// side top to bottom) but on mobile each one collapses to a single
// column independently, so the old order striped away/home/away/home/
// away/home instead of reading as two coherent team blocks.
function teamColumn(side, abbr) {
  return `
    <div class="bs-team-col">
      ${battingTable(side, abbr)}
      ${sideRecap(side, abbr)}
      ${pitchingTable(side, abbr)}
    </div>`
}

function boxscoreDetail(game) {
  const state = $.learn().boxscores[game.gamePk]
  if (state === 'loading' || state === undefined) return `<div class="bs-box-empty">loading box score…</div>`
  if (state === 'error') return `<div class="bs-box-empty">couldn't load box score</div>`
  const away = state.teams.away, home = state.teams.home
  const awayAbbr = game.teams.away.team.abbreviation || game.teams.away.team.name
  const homeAbbr = game.teams.home.team.abbreviation || game.teams.home.team.name
  return `
    <div class="bs-box-detail">
      <div class="bs-box-grid">
        ${teamColumn(away, awayAbbr)}
        ${teamColumn(home, homeAbbr)}
      </div>
    </div>`
}

function gameCard(game) {
  const hasLinescore = (game.linescore?.innings || []).length > 0
  const away = game.teams.away, home = game.teams.home
  return `
    <div class="bs-game">
      <div class="bs-matchup">
        <span>${esc(away.team.name)} ${away.score ?? ''}</span>
        <span class="bs-at">@</span>
        <span>${esc(home.team.name)} ${home.score ?? ''}</span>
      </div>
      ${hasLinescore ? linescoreTable(game) : `<div class="bs-status">${esc(statusLine(game))}</div>`}
      ${hasLinescore && game.status.abstractGameState !== 'Final' ? `<div class="bs-status">${esc(statusLine(game))}</div>` : ''}
      ${hasLinescore ? boxscoreDetail(game) : ''}
    </div>`
}

function renderApp() {
  const { date, games, loading, error, zoom } = $.learn()
  const isToday = date === todayStr()
  return `
    <div class="bs-shell" style="font-size: ${zoom}em">
      <div class="bs-masthead">
        <h1>Box Scores</h1>
        <div class="bs-zoom">
          <button class="bs-nav-btn" data-zoom-out title="Smaller text" ${zoom <= ZOOM_MIN ? 'disabled' : ''}>−</button>
          <button class="bs-nav-btn" data-zoom-in title="Bigger text" ${zoom >= ZOOM_MAX ? 'disabled' : ''}>+</button>
        </div>
        <div class="bs-date-nav">
          <button class="bs-nav-btn" data-shift-date="-1" title="Previous day">←</button>
          <div class="bs-dateline">${esc(date)}</div>
          <button class="bs-nav-btn" data-shift-date="1" title="Next day">→</button>
          ${isToday ? '' : '<button class="bs-nav-btn -today" data-go-today>Today</button>'}
        </div>
        <button class="bs-refresh" data-refresh ${loading ? 'disabled' : ''}>${loading ? 'loading…' : 'Refresh'}</button>
      </div>
      ${error ? `<div class="bs-empty">couldn't load games for ${esc(date)} — ${esc(error)}</div>` : ''}
      ${!error && games === null ? `<div class="bs-empty">loading games for ${esc(date)}…</div>` : ''}
      ${!error && games && games.length === 0 ? `<div class="bs-empty">no MLB games scheduled for ${esc(date)}</div>` : ''}
      ${games && games.length ? `<div class="bs-grid">${games.map(gameCard).join('')}</div>` : ''}
    </div>`
}

$.draw(() => {
  try { return renderApp() } catch (e) {
    console.error('box-scores render error:', e)
    return `<div class="bs-empty">render error — ${esc(e.message)}</div>`
  }
})

export default $

$.when('click', '[data-refresh]', loadGames)
$.when('click', '[data-zoom-in]', () => bumpZoom(ZOOM_STEP))
$.when('click', '[data-zoom-out]', () => bumpZoom(-ZOOM_STEP))
$.when('click', '[data-shift-date]', e => {
  const delta = Number(e.target.closest('[data-shift-date]').dataset.shiftDate)
  goToDate(shiftDate($.learn().date, delta))
})
$.when('click', '[data-go-today]', () => goToDate(todayStr()))

// same black/white/Courier New base as sports-stats.js/accessibility-mode
// — a monospace grid is also just the right tool for aligning inning
// columns, not only a style match.
$.style(`
  & { display: block; height: 100%; width: 100%; overflow: auto; font-family: Courier, 'Courier New', monospace; background: white; color: black; }
  & .bs-shell { padding: 1.2rem; box-sizing: border-box; max-width: 64rem; margin: 0 auto; }
  & .bs-masthead { display: flex; align-items: baseline; gap: 1rem; border-bottom: 2px solid black; padding-bottom: .6rem; margin-bottom: 1rem; flex-wrap: wrap; }
  & h1 { margin: 0; font-size: 1.6em; font-weight: normal; letter-spacing: .08em; text-transform: uppercase; }
  & .bs-zoom { display: flex; gap: .3rem; }
  & .bs-zoom .bs-nav-btn { width: 1.8rem; }
  & .bs-date-nav { display: flex; align-items: center; gap: .5rem; flex: 1; }
  & .bs-dateline { opacity: .8; font-size: .9em; }
  & .bs-nav-btn { font-family: inherit; background: white; color: black; border: 1px solid black; padding: .3rem .6rem; cursor: pointer; }
  & .bs-nav-btn:hover { background: black; color: white; }
  & .bs-nav-btn:disabled { opacity: .4; cursor: default; background: white; color: black; }
  & .bs-nav-btn.-today { font-size: .78em; opacity: .7; }
  & .bs-refresh { font-family: inherit; background: white; color: black; border: 1px solid black; padding: .35rem .7rem; cursor: pointer; }
  & .bs-refresh:hover { background: black; color: white; }
  & .bs-refresh:disabled { opacity: .5; cursor: default; background: white; color: black; }
  & .bs-empty { opacity: .55; font-size: .9em; padding: 1rem 0; }
  & .bs-grid { display: flex; flex-direction: column; gap: 1.4rem; }
  & .bs-game { border: 1px solid black; padding: .7rem; }
  & .bs-matchup { display: flex; justify-content: space-between; gap: .5rem; font-size: .95em; margin-bottom: .5rem; }
  & .bs-at { opacity: .5; }
  /* table-layout: fixed on purpose — with the default auto layout, each
     game's own column widths shift with its own content (a team
     abbreviation, a decision note, a number of innings), so nothing
     lines up game to game or team to team. Fixed ignores content width
     entirely: one column gets an explicit width, the rest split the
     remainder evenly, so every table reads as the same clean grid. */
  & .bs-linescore { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .82em; }
  & .bs-linescore th, & .bs-linescore td { border: 1px solid black; padding: .2rem .35rem; text-align: center; }
  & .bs-linescore .bs-team-col { width: 3.6em; text-align: left; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .bs-linescore .bs-rhe { width: 1.8em; font-weight: bold; }
  & .bs-linescore thead th { font-weight: normal; opacity: .6; }
  & .bs-status { margin-top: .5rem; font-size: .8em; opacity: .6; text-transform: uppercase; letter-spacing: .04em; }

  /* === expandable batting/pitching, standard newspaper box score === */
  & .bs-box-empty { margin-top: .6rem; opacity: .55; font-size: .8em; }
  & .bs-box-detail { margin-top: .6rem; display: flex; flex-direction: column; gap: .6rem; }
  & .bs-box-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .6rem; align-items: start; }
  & .bs-team-col { display: flex; flex-direction: column; gap: .6rem; }
  & .bs-boxtable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .76em; }
  & .bs-boxtable caption { text-align: left; font-size: .7em; text-transform: uppercase; letter-spacing: .04em; opacity: .6; padding-bottom: .2rem; caption-side: top; }
  & .bs-boxtable th, & .bs-boxtable td { border: 1px solid black; padding: .15rem .3rem; text-align: center; }
  & .bs-boxtable thead th { font-weight: normal; opacity: .6; }
  & .bs-boxtable .bs-name-col { width: 40%; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .bs-boxtable .bs-ip-col { width: 3.4em; }
  & .bs-boxtable .bs-pos { opacity: .55; font-size: .9em; }
  & .bs-boxtable .bs-decision { opacity: .6; font-size: .9em; }
  & .bs-boxtable .bs-totals { font-weight: bold; }
  & .bs-notes { font-size: .76em; opacity: .75; display: flex; flex-direction: column; gap: .1rem; }
  & .bs-notes-caption { font-size: .92em; text-transform: uppercase; letter-spacing: .04em; opacity: .8; margin-bottom: .1rem; }
`)
