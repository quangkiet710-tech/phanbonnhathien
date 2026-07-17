// ============================================================
// ĐỒNG BỘ DỮ LIỆU QUA SUPABASE
// Bảng: pos_store (id text PK, data jsonb, updated_at timestamptz)
// Chỉ dùng 1 dòng duy nhất id = 'nhathien-main'
// ============================================================
(function () {
  const SUPABASE_URL = 'https://yzmdxyxdzksleslwiyjg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6bWR4eXhkemtzbGVzbHdpeWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjc4NjIsImV4cCI6MjA5ODcwMzg2Mn0.JFVxV4Ti1EbNZT-uWxRDDbcQ_RdX3w2LxEZ8rVTjMxU';
  const TABLE = 'pos_store';
  const ROW_ID = 'nhathien-main';
  const LOCAL_KEY = 'agropos_v2';
  const META_KEY = 'agropos_v2_meta';
  const DEBOUNCE_MS = 2000;

  if (typeof window.supabase === 'undefined') {
    console.error('[sync] Chưa nạp được thư viện supabase-js.');
    return;
  }
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---------- chỉ báo trạng thái ----------
  let indicatorEl = null;
  function ensureIndicator() {
    if (indicatorEl) return indicatorEl;
    indicatorEl = document.createElement('div');
    indicatorEl.id = 'sync-indicator';
    indicatorEl.style.cssText =
      'position:fixed;bottom:8px;right:8px;z-index:99999;background:rgba(0,0,0,.68);' +
      'color:#fff;font-size:11px;line-height:1;padding:5px 9px;border-radius:14px;' +
      'font-family:Arial,sans-serif;pointer-events:none;user-select:none;box-shadow:0 1px 4px rgba(0,0,0,.25)';
    document.body.appendChild(indicatorEl);
    return indicatorEl;
  }
  function setStatus(state) {
    const el = ensureIndicator();
    const label = {
      synced: '🟢 Đã đồng bộ',
      syncing: '🟡 Đang đồng bộ...',
      offline: '🔴 Mất mạng'
    }[state] || '';
    el.textContent = label;
  }

  // ---------- meta cục bộ (thời điểm dữ liệu máy được cập nhật lần cuối) ----------
  function getMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; }
  }
  function setMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }
  function markLocalChanged() { setMeta({ updatedAt: Date.now() }); }

  // ---------- đẩy dữ liệu lên Supabase (debounce) ----------
  let pushTimer = null;
  function schedulePush() {
    setStatus(navigator.onLine ? 'syncing' : 'offline');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, DEBOUNCE_MS);
  }
  async function pushNow() {
    pushTimer = null;
    if (!navigator.onLine) { setStatus('offline'); return; }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const meta = getMeta();
    const updatedAt = meta.updatedAt || Date.now();
    setStatus('syncing');
    try {
      const { error } = await client.from(TABLE).upsert({
        id: ROW_ID,
        data: JSON.parse(raw),
        updated_at: new Date(updatedAt).toISOString()
      });
      if (error) throw error;
      setStatus('synced');
    } catch (e) {
      console.error('[sync] Đẩy dữ liệu lên Supabase thất bại:', e);
      setStatus(navigator.onLine ? 'synced' : 'offline');
    }
  }

  // ---------- tải dữ liệu từ Supabase khi mở app ----------
  async function pullAndMaybeReload() {
    if (!navigator.onLine) { setStatus('offline'); return; }
    setStatus('syncing');
    try {
      const { data, error } = await client
        .from(TABLE)
        .select('data, updated_at')
        .eq('id', ROW_ID)
        .maybeSingle();
      if (error) throw error;
      if (data && data.updated_at) {
        const cloudTime = new Date(data.updated_at).getTime();
        const localTime = getMeta().updatedAt || 0;
        if (cloudTime > localTime) {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(data.data));
          setMeta({ updatedAt: cloudTime });
          location.reload();
          return;
        }
      }
      setStatus('synced');
    } catch (e) {
      console.error('[sync] Tải dữ liệu từ Supabase thất bại:', e);
      setStatus(navigator.onLine ? 'synced' : 'offline');
    }
  }

  // ---------- gắn vào saveDB() của app ----------
  function hookSaveDB() {
    if (typeof window.saveDB !== 'function') { setTimeout(hookSaveDB, 200); return; }
    const originalSaveDB = window.saveDB;
    window.saveDB = function () {
      originalSaveDB.apply(this, arguments);
      markLocalChanged();
      schedulePush();
    };
  }

  // ---------- trạng thái mạng ----------
  window.addEventListener('online', () => { setStatus('syncing'); pushNow(); });
  window.addEventListener('offline', () => setStatus('offline'));

  ensureIndicator();
  hookSaveDB();
  pullAndMaybeReload();
})();
