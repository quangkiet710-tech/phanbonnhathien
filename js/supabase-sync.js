(function () {
  const SUPABASE_URL = 'https://yzmdxyxdzksleslwiyjg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Inl6bWR4eXhkemtzbGVzbHdpeWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjc4NjIsImV4cCI6MjA5ODcwMzg2Mn0.JFVxV4Ti1EbNZT-uWxRDDbcQ_RdX3w2LxEZ8rVTjMxU';

  const TABLE = 'pos_store';
  const ROW_ID = 'nhathien-main';
  const LOCAL_KEY = 'agropos_v2';
  const META_KEY = 'agropos_v2_meta';

  // 🔥 3 giây sync 1 lần
  const POLL_INTERVAL = 3000;

  if (!window.supabase) {
    console.error('Không có supabase');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function getMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY)) || {};
    } catch {
      return {};
    }
  }

  function setMeta(m) {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  }

  function markLocalChanged() {
    setMeta({ updatedAt: Date.now() });
  }

  async function pushNow() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);

      await client.from(TABLE).upsert({
        id: ROW_ID,
        data: data,
        updated_at: new Date().toISOString()
      });

      console.log('✅ Đã push lên cloud');
    } catch (e) {
      console.error('❌ Lỗi push:', e);
    }
  }

  async function pullNow() {
    try {
      const { data, error } = await client
        .from(TABLE)
        .select('data, updated_at')
        .eq('id', ROW_ID)
        .maybeSingle();

      if (error) throw error;
      if (!data) return;

      const cloudTime = new Date(data.updated_at).getTime();
      const localTime = getMeta().updatedAt || 0;

      if (cloudTime > localTime) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(data.data));
        setMeta({ updatedAt: cloudTime });

        console.log('🔄 Đã kéo dữ liệu mới');
        location.reload();
      }
    } catch (e) {
      console.error('❌ Lỗi pull:', e);
    }
  }

  // 🔥 LUÔN kéo dữ liệu ngay khi mở
  pullNow();

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

      console.log('💾 Đã lưu + sync');
      location.reload();
    };
  }

  hookSaveDB();
})();
