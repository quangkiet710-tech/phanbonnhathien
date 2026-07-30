// ============================================================
// ĐỒNG BỘ DỮ LIỆU QUA SUPABASE (FIX REALTIME GẦN)
// ============================================================
(function () {
  const SUPABASE_URL = 'https://yzmdxyxdzksleslwiyjg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6bWR4eXhkemtzbGVzbHdpeWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjc4NjIsImV4cCI6MjA5ODcwMzg2Mn0.JFVxV4Ti1EbNZT-uWxRDDbcQ_RdX3w2LxEZ8rVTjMxU';
  const TABLE = 'pos_store';
  const ROW_ID = 'nhathien-main';
  const LOCAL_KEY = 'agropos_v2';
  const META_KEY = 'agropos_v2_meta';
  const DEBOUNCE_MS = 2000;

  // 🔥 GIẢM TỪ 15s → 1s
  const POLL_INTERVAL = 1000;

  if (typeof window.supabase === 'undefined') {
    console.error('[sync] Chưa nạp được supabase');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function getMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; }
  }

  function setMeta(m) {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  }

  function markLocalChanged() {
    setMeta({ updatedAt: Date.now() });
  }

  async function pushNow() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);

    await client.from(TABLE).upsert({
      id: ROW_ID,
      data: data,
      updated_at: new Date().toISOString()
    });
  }

  async function pullNow() {
    const { data } = await client
      .from(TABLE)
      .select('data, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (!data) return;

    const cloudTime = new Date(data.updated_at).getTime();
    const localTime = getMeta().updatedAt || 0;

    if (cloudTime > localTime) {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data.data));
      setMeta({ updatedAt: cloudTime });
      location.reload(); // 🔥 reload khi có dữ liệu mới
    }
  }

  // 🔥 polling liên tục
  setInterval(pullNow, POLL_INTERVAL);

  // 🔥 hook save
  function hookSaveDB() {
    if (typeof window.saveDB !== 'function') {
      setTimeout(hookSaveDB, 200);
      return;
    }

    const originalSaveDB = window.saveDB;

    window.saveDB = function () {
      originalSaveDB.apply(this, arguments);
      markLocalChanged();
      pushNow();
      location.reload(); // 🔥 reload ngay khi lưu
    };
  }

  hookSaveDB();
})();
