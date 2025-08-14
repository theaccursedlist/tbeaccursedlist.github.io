import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Change this if you use a different alias domain for emails
const ALIAS_DOMAIN = 'accursed.list'; // <-- match exactly what you used in Supabase

// —————— REQUIRED: paste your Supabase project values ——————
const SUPABASE_URL = 'https://jkwbbsdfeqqylqfsnhih.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imprd2Jic2RmZXFxeWxxZnNuaGloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNTA0MDcsImV4cCI6MjA3MDcyNjQwN30.o9G0Rq7mpygC2-P4vldWbl4WsCTttYhNmlRs1dAHTLk';
// Sessions not persisted (forces login every visit)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Simple hash router
const routes = ['start','login','submit','app'];
const authedSubroutes = ['list','account','dashboard'];
let currentUser = null; // supabase auth user
let profile = null;     // row from profiles

const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];

qsa('[data-nav]').forEach(el=>el.addEventListener('click',e=>{
  const to = el.getAttribute('data-nav'); if (to) location.hash = to;
}));

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', init);

async function init(){
  // Auth change
  supabase.auth.onAuthStateChange(async (_evt, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      profile = await fetchOwnProfile();
      showAppShell();
    } else {
      hideAppShell();
    }
    handleRoute();
  });

  // initial route
  const { data } = await supabase.auth.getUser();
  currentUser = data.user || null;
  if (currentUser) profile = await fetchOwnProfile();
  handleRoute();

  // forms
  qs('#loginForm')?.addEventListener('submit', onLogin);
  qs('#logoutBtn')?.addEventListener('click', onLogout);

  qs('#submitForm')?.addEventListener('submit', onPublicSubmit);
  qs('#cancelSubmit')?.addEventListener('click', ()=>{
    if (confirm('Cancel submission? Your text will be lost.')) location.hash = '#/start';
  });

  // realtime listeners
  setupRealtime();
}

function handleRoute(){
  const h = location.hash || '#/start';
  const [, pathRaw] = h.split('#/');
  const path = pathRaw || 'start';

  // Guarded subroutes
  if (authedSubroutes.includes(path)) {
    return currentUser ? showAuthed(path) : redirectStart();
  }

  switch (path) {
    case 'start': showOnly('start'); break;
    case 'login': showOnly('login'); break;
    case 'submit': showOnly('submit'); break;
    case 'list':
    case 'account':
    case 'dashboard':
      // normalized into app shell
      return currentUser ? showAuthed(path) : redirectStart();
    default:
      showOnly('start');
  }
}

function redirectStart(){ location.hash = '#/start'; }

function showOnly(route){
  qsa('.route').forEach(r=>r.classList.remove('show'));
  qs(`.route[data-route="${route}"]`)?.classList.add('show');
}

function showAppShell(){
  showOnly('app');
  // Role-gate dashboard
  qsa('.admin-only').forEach(el=>{
    el.style.display = (profile?.role === 'admin') ? '' : 'none';
  });
  // default subroute
  const sub = (location.hash.replace('#/','')||'list');
  showSubroute(authedSubroutes.includes(sub) ? sub : 'list');
  renderAccount();
  refreshList();
  if (profile?.role === 'admin') refreshQueue();
}

function hideAppShell(){ showOnly('start'); }

function showAuthed(sub){ showOnly('app'); showSubroute(sub); }

function showSubroute(sub){
  qsa('.nav-link').forEach(a=>a.classList.remove('active'));
  qsa(`.nav-link[data-nav="#/${sub}"]`).forEach(a=>a.classList.add('active'));
  qsa('.panel').forEach(p=>p.classList.remove('show'));
  qs(`.panel[data-subroute="${sub}"]`)?.classList.add('show');
  if (sub === 'list') refreshList();
  if (sub === 'dashboard' && profile?.role === 'admin') refreshQueue();
}

async function onLogin(e){
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const username = (f.get('username')||'').toString().trim();
  const password = (f.get('password')||'').toString();
  const input = (f.get('username')||'').toString().trim();
  const emailAlias = input.includes('@') ? input : `${input}@${ALIAS_DOMAIN}`;
  qs('#loginError').textContent = '';
  const { error } = await supabase.auth.signInWithPassword({ email: emailAlias, password });
  if (error) qs('#loginError').textContent = 'Invalid credentials.';
}

async function onLogout(){ await supabase.auth.signOut(); location.hash = '#/start'; }

async function fetchOwnProfile(){
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', (await supabase.auth.getUser()).data.user.id)
    .maybeSingle();
  if (error) console.warn(error);
  return data || null;
}

function renderAccount(){
  if (!profile) return;
  qs('#acctAvatar').src = profile.avatar_url || '';
  qs('#acctUsername').textContent = profile.username || '';
  qs('#acctTitle').textContent = profile.title || '';
}

// —————— LIST (Apple‑Watch‑style grid) ——————
let gridState = { items: [], offsetX: 0, offsetY: 0, dragging:false, startX:0, startY:0 };
const gridEl = qs('#grid');
const tooltipEl = qs('#tooltip');
const ttAvatar = qs('#ttAvatar');
const ttName = qs('#ttName');
const ttReason = qs('#ttReason');

function safe(t){ return (t||'').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }

async function refreshList(){
  const { data, error } = await supabase
    .from('accursed')
    .select('id,username,avatar_url,reason')
    .order('created_at', { ascending:false });
  if (error) { console.warn(error); return; }
  gridState.items = data || [];
  layoutGrid();
}

function layoutGrid(){
  gridEl.innerHTML = '';
  const { items } = gridState;
  const spacing = 120; // base spacing between nodes
  const positions = hexPositions(items.length, spacing);

  positions.forEach((pos, i) => {
    const item = items[i];
    const node = document.createElement('div');
    node.className = 'node';
    node.dataset.idx = String(i);
    node.innerHTML = `<img alt="${safe(item.username)}" src="${safe(item.avatar_url)}">`;
    gridEl.appendChild(node);
  });

  const host = qs('#gridHost');
  const center = () => ({ x: host.clientWidth/2, y: host.clientHeight/2 });

  function render(){
    const c = center();
    qsa('.node').forEach(n => {
      const i = +n.dataset.idx; const p = positions[i];
      const x = p.x + gridState.offsetX; const y = p.y + gridState.offsetY;
      const dx = x - c.x, dy = y - c.y;
      const dist = Math.hypot(dx, dy);
      // Scale bigger near center; clamp between 0.7 and 2.4
      const scale = Math.max(0.7, Math.min(2.4, 2.4 - dist/320));
      n.style.transform = `translate(${x}px,${y}px) scale(${scale.toFixed(3)})`;
    });
  }

  render();
  window.addEventListener('resize', render);

  // Pointer pan + tooltip
  gridEl.onpointerdown = e => { gridState.dragging = true; gridState.startX = e.clientX; gridState.startY = e.clientY; tooltipEl.hidden = true; };
  window.onpointerup = () => { gridState.dragging = false; };
  window.onpointermove = e => {
    if (gridState.dragging){
      gridState.offsetX += (e.clientX - gridState.startX);
      gridState.offsetY += (e.clientY - gridState.startY);
      gridState.startX = e.clientX; gridState.startY = e.clientY;
      render();
    }
  };

  gridEl.onclick = e => {
    const node = e.target.closest('.node');
    if (!node) return;
    const i = +node.dataset.idx; const item = gridState.items[i];
    const rect = node.getBoundingClientRect();
    ttAvatar.src = item.avatar_url; ttName.textContent = item.username; ttReason.textContent = item.reason;
    tooltipEl.style.left = Math.max(12, rect.left + rect.width/2 + 14) + 'px';
    tooltipEl.style.top = Math.max(12, rect.top - 10) + 'px';
    tooltipEl.hidden = false;
  };

  host.addEventListener('mouseleave', ()=> tooltipEl.hidden = true);
}

function hexPositions(n, s){
  // Generate roughly hex/honeycomb around origin, then shift to viewport center
  const pts = [];
  let ring = 0, count = 0;
  while (pts.length < n){
    if (ring === 0){ pts.push({x:0,y:0}); ring++; continue; }
    const steps = ring * 6;
    for (let k=0;k<steps && pts.length<n;k++){
      const angle = (k/steps)*Math.PI*2;
      const r = ring * s * 0.8;
      pts.push({ x: Math.cos(angle)*r, y: Math.sin(angle)*r });
    }
    ring++;
  }
  // Move to center of the host
  const host = qs('#gridHost');
  const cx = host.clientWidth/2, cy = host.clientHeight/2;
  return pts.map(p => ({ x: p.x + cx, y: p.y + cy }));
}

// —————— PUBLIC SUBMISSIONS ——————
async function onPublicSubmit(e){
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const payload = {
    target_username: (f.get('target_username')||'').toString().trim(),
    target_avatar_url: (f.get('avatar_url')||'').toString().trim(),
    reason: (f.get('reason')||'').toString().trim(),
  };
  if (!payload.target_username || !payload.target_avatar_url || !payload.reason){ return; }
  const { error } = await supabase.from('submissions').insert(payload);
  const msg = qs('#submitMsg');
  if (error){ msg.textContent = 'Failed to submit. Try again later.'; return; }
  msg.textContent = 'Submitted. The Order will review.';
  e.currentTarget.reset();
}

// —————— DASHBOARD (ADMIN) ——————
async function refreshQueue(){
  if (profile?.role !== 'admin') return;
  const { data, error } = await supabase
    .from('submissions')
    .select('id,target_username,target_avatar_url,reason,created_at,status')
    .eq('status','pending')
    .order('created_at',{ascending:false});
  if (error){ console.warn(error); return; }
  renderQueue(data||[]);
}

function renderQueue(rows){
  const host = qs('#queue'); host.innerHTML = '';
  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.innerHTML = `
      <div class="queue-main">
        <img src="${safe(r.target_avatar_url)}" alt="avatar"/>
        <div>
          <div><strong>${safe(r.target_username)}</strong></div>
          <div class="muted small">${safe(r.reason)}</div>
          <div class="badge">${new Date(r.created_at).toLocaleString()}</div>
        </div>
      </div>
      <div class="queue-actions">
        <button class="btn btn-ghost" data-act="reject" data-id="${r.id}">Reject</button>
        <button class="btn btn-primary" data-act="accept" data-id="${r.id}">Accept</button>
      </div>`;
    host.appendChild(el);
  });
  host.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = +b.dataset.id; const act = b.dataset.act;
    if (act === 'reject') await rejectSubmission(id);
    if (act === 'accept') await acceptSubmission(id);
  };
}

async function acceptSubmission(id){
  if (profile?.role !== 'admin') return;
  const { data, error } = await supabase
    .from('submissions')
    .select('*').eq('id', id).maybeSingle();
  if (error || !data) return;
  // 1) add to accursed
  const ins = await supabase.from('accursed').insert({
    username: data.target_username,
    avatar_url: data.target_avatar_url,
    reason: data.reason,
    created_by: currentUser.id,
  });
  if (ins.error) { console.warn(ins.error); return; }
  // 2) mark accepted
  await supabase.from('submissions').update({ status: 'accepted' }).eq('id', id);
}

async function rejectSubmission(id){
  if (profile?.role !== 'admin') return;
  await supabase.from('submissions').update({ status: 'rejected' }).eq('id', id);
}

// —————— REALTIME ——————
function setupRealtime(){
  supabase.channel('any')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, payload => {
      if (profile?.role === 'admin') refreshQueue();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accursed' }, payload => {
      refreshList();
    })
    .subscribe();
}
