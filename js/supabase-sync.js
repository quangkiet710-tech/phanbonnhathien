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
  // ID gốc trong dữ liệu mẫu (DEFAULT) của app — dùng để nhận diện dữ liệu
  // "chưa từng được người dùng chỉnh sửa" nhằm tránh đè mất dữ liệu thật trên cloud.
  const SEED_CUSTOMER_IDS = 'c1,c2,c3';
  const SEED_PRODUCT_IDS = 'p1,p2,p3,p4,p5,p6,p7,p8';
  const SEED_INVOICE_IDS = 'HD001,HD002,HD003';

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

  // ---------- nhận diện dữ liệu rỗng / còn nguyên dữ liệu mẫu ----------
  // Mục đích: không bao giờ để một bản dữ liệu "trống" hoặc "chưa từng chỉnh sửa"
  // (do lỗi tải, do máy mới, do localStorage bị xoá...) đè mất dữ liệu thật trên cloud.
  function looksEmpty(data) {
    if (!data || typeof data !== 'object') return true;
    const c = Array.isArray(data.customers) ? data.customers.length : 0;
    const p = Array.isArray(data.products) ? data.products.length : 0;
    const i = Array.isArray(data.invoices) ? data.invoices.length : 0;
    return c === 0 && p === 0 && i === 0;
  }
  function looksLikeUntouchedSeed(data) {
    try {
      const cIds = (data.customers || []).map(x => x.id).sort().join(',');
      const pIds = (data.products || []).map(x => x.id).sort().join(',');
      const iIds = (data.invoices || []).map(x => x.id).sort().join(',');
      return cIds === SEED_CUSTOMER_IDS && pIds === SEED_PRODUCT_IDS && iIds === SEED_INVOICE_IDS;
    } catch (e) { return false; }
  }
  function isRiskyLocalData(data) {
    return looksEmpty(data) || looksLikeUntouchedSeed(data);
  }

  // ---------- đẩy dữ liệu lên Supabase (debounce) ----------
  let pushTimer = null;
  // Chờ lần tải-về-so-sánh đầu tiên xong mới cho phép đẩy lên, để không có
  // trường hợp app vừa mở đã đẩy dữ liệu máy (có thể còn cũ/rỗng) đè lên cloud
  // trước khi kịp biết cloud đang có gì.
  let initialPullDone = false;
  let pushPendingAfterPull = false;
  function schedulePush() {
    if (!initialPullDone) { pushPendingAfterPull = true; setStatus('syncing'); return; }
    setStatus(navigator.onLine ? 'syncing' : 'offline');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, DEBOUNCE_MS);
  }
  async function pushNow() {
    pushTimer = null;
    if (!navigator.onLine) { setStatus('offline'); return; }
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    let localData;
    try { localData = JSON.parse(raw); } catch (e) { return; }

    if (isRiskyLocalData(localData)) {
      // Dữ liệu máy trông như rỗng hoặc còn nguyên dữ liệu mẫu -> kiểm tra cloud
      // trước, tuyệt đối không đè lên nếu cloud đang có dữ liệu thật.
      try {
        const { data: cloudRow, error } = await client.from(TABLE).select('data').eq('id', ROW_ID).maybeSingle();
        if (error) throw error;
        if (cloudRow && cloudRow.data && !isRiskyLocalData(cloudRow.data)) {
          console.warn('[sync] Bỏ qua đẩy dữ liệu lên cloud vì dữ liệu máy trông rỗng/mặc định trong khi cloud đang có dữ liệu thật.');
          setStatus('synced');
          return;
        }
      } catch (e) {
        // Không xác nhận được cloud đang có gì -> khi nghi ngờ, không đẩy lên.
        console.warn('[sync] Không kiểm tra được dữ liệu cloud, tạm hoãn đẩy dữ liệu nghi ngờ.', e);
        setStatus(navigator.onLine ? 'synced' : 'offline');
        return;
      }
    }

    const meta = getMeta();
    const updatedAt = meta.updatedAt || Date.now();
    setStatus('syncing');
    try {
      const { error } = await client.from(TABLE).upsert({
        id: ROW_ID,
        data: localData,
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
  function finishInitialPull() {
    initialPullDone = true;
    if (pushPendingAfterPull) {
      pushPendingAfterPull = false;
      schedulePush();
    }
  }
  async function pullAndMaybeReload() {
    if (!navigator.onLine) { setStatus('offline'); finishInitialPull(); return; }
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
        const localRaw = localStorage.getItem(LOCAL_KEY);
        let localData = null;
        try { localData = localRaw ? JSON.parse(localRaw) : null; } catch (e) { localData = null; }

        // Cloud có dữ liệu thật, máy trống/mặc định hoặc chưa từng đồng bộ -> luôn ưu tiên cloud.
        const shouldPreferCloud =
          !isRiskyLocalData(data.data) &&
          (isRiskyLocalData(localData) || cloudTime > localTime);

        if (shouldPreferCloud) {
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
    finishInitialPull();
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
  window.addEventListener('online', () => { setStatus('syncing'); if (initialPullDone) pushNow(); });
  window.addEventListener('offline', () => setStatus('offline'));

  ensureIndicator();
  hookSaveDB();
  pullAndMaybeReload();
})();
