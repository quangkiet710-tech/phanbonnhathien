// ============================================================
// ĐỒNG BỘ DỮ LIỆU QUA SUPABASE — GỘP THEO TỪNG BẢN GHI
// Bảng: pos_store (id text PK, data jsonb, updated_at timestamptz)
// Chỉ dùng 1 dòng duy nhất id = 'nhathien-main'
//
// NGUYÊN TẮC: KHÔNG BAO GIỜ THAY NGUYÊN CỤC DỮ LIỆU.
// Máy và cloud được HOÀ vào nhau theo từng bản ghi (id). Ghi chép có ở
// một bên thì bên kia nhận thêm — không bên nào xoá được dữ liệu của bên kia.
// Muốn xoá thật thì phải xoá trong app, lúc đó mới sinh "bia mộ" (tombstone).
// ============================================================
(function () {
  const SUPABASE_URL = 'https://yzmdxyxdzksleslwiyjg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6bWR4eXhkemtzbGVzbHdpeWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMjc4NjIsImV4cCI6MjA5ODcwMzg2Mn0.JFVxV4Ti1EbNZT-uWxRDDbcQ_RdX3w2LxEZ8rVTjMxU';
  const TABLE = 'pos_store';
  const ROW_ID = 'nhathien-main';
  const LOCAL_KEY = 'agropos_v2';
  const META_KEY = 'agropos_v2_meta';
  const PREV_KEY = 'agropos_v2_prev';      // ảnh chụp lần lưu trước, dùng để biết bản ghi nào vừa đổi
  const BACKUP_KEY = 'agropos_v2_backups'; // lưới an toàn: các bản sao gần đây
  const JOURNAL_KEY = 'agropos_v2_journal'; // nhật ký chỉ-ghi-thêm, không bao giờ bị gộp
  const MAX_JOURNAL = 800;
  const DEBOUNCE_MS = 400;
  const POLL_INTERVAL = 15000;
  // Mỗi bản sao nặng bằng cả cục dữ liệu (~140 KB, trình duyệt lưu 2 byte/ký tự
  // nên tốn gấp đôi). Giữ 12 bản là ngốn ~3,4 MB, sát trần ~5 MB của trình duyệt
  // và làm lệnh lưu có nguy cơ văng lỗi hết chỗ. Giữ 4 bản là đủ dùng.
  const MAX_BACKUPS = 4;

  // Các bảng dữ liệu dạng mảng có khoá 'id'
  const COLLECTIONS = ['products', 'customers', 'invoices', 'stockImports', 'custOrders', 'dailySales', 'priceHistory', 'inventoryChecks'];

  const SEED_CUSTOMER_IDS = 'c1,c2,c3';
  const SEED_PRODUCT_IDS = 'p1,p2,p3,p4,p5,p6,p7,p8';
  const SEED_INVOICE_IDS = 'HD001,HD002,HD003';

  if (typeof window.supabase === 'undefined') {
    console.error('[sync] Chưa nạp được thư viện supabase-js.');
    return;
  }
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---------------------------------------------------------
  // Chỉ báo trạng thái — PHẢI NÓI THẬT
  // ---------------------------------------------------------
  let indicatorEl = null, lastError = '';
  function ensureIndicator() {
    if (indicatorEl) return indicatorEl;
    indicatorEl = document.createElement('div');
    indicatorEl.id = 'sync-indicator';
    indicatorEl.style.cssText =
      'position:fixed;bottom:8px;right:8px;z-index:99999;background:rgba(0,0,0,.68);' +
      'color:#fff;font-size:11px;line-height:1;padding:5px 9px;border-radius:14px;' +
      'font-family:Arial,sans-serif;cursor:pointer;user-select:none;box-shadow:0 1px 4px rgba(0,0,0,.25)';
    indicatorEl.onclick = function () {
      if (lastError) alert('Lỗi đồng bộ gần nhất:\n\n' + lastError + '\n\nDữ liệu vẫn được giữ trong máy. App sẽ tự thử lại.');
      else alert('Đồng bộ bình thường.\nLần cuối lên cloud: ' + (getMeta().pushedAt ? new Date(getMeta().pushedAt).toLocaleString('vi-VN') : 'chưa lần nào'));
    };
    document.body.appendChild(indicatorEl);
    return indicatorEl;
  }
  function setStatus(state, err) {
    const el = ensureIndicator();
    lastError = err || '';
    const label = {
      synced: '🟢 Đã đồng bộ',
      syncing: '🟡 Đang đồng bộ...',
      offline: '🔴 Mất mạng — chưa lên cloud',
      error: '🔴 LỖI: chưa lưu được lên cloud',
      pending: '🟠 Có thay đổi chưa lên cloud'
    }[state] || '';
    el.textContent = label;
    el.style.background = (state === 'error' || state === 'offline') ? 'rgba(190,20,20,.92)'
      : (state === 'pending' ? 'rgba(200,110,0,.92)' : 'rgba(0,0,0,.68)');
  }

  // ---------------------------------------------------------
  // Tiện ích
  // ---------------------------------------------------------
  function getMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
  function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(Object.assign(getMeta(), m))); } catch (e) {} }
  function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { return null; } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // So sánh nội dung bản ghi, bỏ qua dấu thời gian nội bộ
  function bodyOf(r) { const c = Object.assign({}, r); delete c._ts; return JSON.stringify(c); }
  function isModalOpen() { return !!document.querySelector('.modal-overlay'); }

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
  function isRiskyData(data) { return looksEmpty(data) || looksLikeUntouchedSeed(data); }

  // Bỏ những bản ghi mang đúng id của dữ liệu mẫu mà cloud (dữ liệu thật) không có.
  // Id thật của cửa hàng do app sinh ra (dạng 'pms...', 'CUS...') nên không đụng nhau.
  const SEED_IDS = {
    products: SEED_PRODUCT_IDS.split(','),
    customers: SEED_CUSTOMER_IDS.split(','),
    invoices: SEED_INVOICE_IDS.split(',')
  };
  function stripSeedRemnants(local, cloud) {
    if (!local || !cloud) return local;
    let changed = false;
    const out = clone(local);
    Object.keys(SEED_IDS).forEach(k => {
      if (!Array.isArray(out[k])) return;
      const cloudIds = {};
      (Array.isArray(cloud[k]) ? cloud[k] : []).forEach(r => { if (r && r.id != null) cloudIds[r.id] = 1; });
      const before = out[k].length;
      out[k] = out[k].filter(r => !(r && SEED_IDS[k].indexOf(r.id) >= 0 && !cloudIds[r.id]));
      if (out[k].length !== before) changed = true;
    });
    if (changed) console.warn('[sync] Đã loại bỏ tàn dư dữ liệu mẫu trước khi đồng bộ.');
    return changed ? out : local;
  }

  // ---------------------------------------------------------
  // LƯỚI AN TOÀN: sao lưu cục bộ trước mỗi lần dữ liệu bị thay đổi
  // ---------------------------------------------------------
  function pushBackup(data, reason) {
    if (!data || isRiskyData(data)) return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BACKUP_KEY)) || []; } catch (e) { list = []; }
    const snap = JSON.stringify(data);
    if (list.length && list[list.length - 1].snap === snap) return; // không lưu trùng
    list.push({ at: Date.now(), reason: reason || '', snap: snap });
    while (list.length > MAX_BACKUPS) list.shift();
    for (;;) {
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); break; }
      catch (e) { list.shift(); if (!list.length) break; } // hết chỗ thì bỏ bản cũ nhất
    }
  }
  window.__syncBackups = function () {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BACKUP_KEY)) || []; } catch (e) {}
    return list.map((b, i) => {
      let d = null; try { d = JSON.parse(b.snap); } catch (e) {}
      return {
        index: i, at: b.at, time: new Date(b.at).toLocaleString('vi-VN'), reason: b.reason,
        dailySales: d && d.dailySales ? d.dailySales.length : 0,
        customers: d && d.customers ? d.customers.length : 0,
        products: d && d.products ? d.products.length : 0,
        invoices: d && d.invoices ? d.invoices.length : 0
      };
    });
  };
  window.__syncBackupData = function (i) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BACKUP_KEY)) || []; } catch (e) {}
    if (!list[i]) return null;
    try { return JSON.parse(list[i].snap); } catch (e) { return null; }
  };

  // ---------------------------------------------------------
  // NHẬT KÝ: mọi bản ghi từng được lưu đều được chép vào đây, chỉ ghi thêm,
  // không bao giờ bị gộp hay bị đồng bộ đụng tới. Đây là lưới an toàn cuối
  // cùng: kể cả phần đồng bộ có sai, dữ liệu vẫn còn ở đây để lấy lại.
  // ---------------------------------------------------------
  function appendJournal(list) {
    if (!list || !list.length) return;
    let j = [];
    try { j = JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; } catch (e) { j = []; }
    const now = Date.now();
    list.forEach(x => j.push({ at: now, coll: x.coll, rec: x.rec }));
    while (j.length > MAX_JOURNAL) j.shift();
    for (;;) {
      try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j)); break; }
      catch (e) { j.splice(0, Math.max(1, Math.floor(j.length / 4))); if (!j.length) break; }
    }
  }
  window.__syncJournal = function () {
    try { return JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; } catch (e) { return []; }
  };

  // ---------------------------------------------------------
  // ĐÁNH DẤU THAY ĐỔI: chỉ gắn dấu thời gian cho bản ghi mới/vừa sửa.
  //
  // TUYỆT ĐỐI KHÔNG suy ra "đã xoá" bằng cách so ảnh chụp trước/sau. Ngày
  // 03/08 cách làm đó đã xoá oan 19 ghi chép: bản trong bộ nhớ trang cũ hơn
  // bản dưới ổ đĩa, ghi đè xuống thì phần chênh bị hiểu nhầm là người dùng
  // xoá. Nay chỉ có nút Xoá trong app mới sinh được bia mộ.
  // ---------------------------------------------------------
  function indexById(arr) {
    const m = {};
    (Array.isArray(arr) ? arr : []).forEach(r => { if (r && r.id != null) m[r.id] = r; });
    return m;
  }
  function stampChanges(data) {
    if (!data || typeof data !== 'object') return data;
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(PREV_KEY)); } catch (e) { prev = null; }
    const now = Date.now();
    data._deleted = data._deleted || {};
    const vuaLuu = [];
    COLLECTIONS.forEach(k => {
      const cur = Array.isArray(data[k]) ? data[k] : [];
      const prevMap = prev ? indexById(prev[k]) : null;
      cur.forEach(r => {
        if (!r || typeof r !== 'object' || r.id == null) return;
        const p = prevMap ? prevMap[r.id] : undefined;
        if (!p) { if (!r._ts) r._ts = now; vuaLuu.push({ coll: k, rec: r }); return; }  // mới
        if (bodyOf(p) !== bodyOf(r)) { r._ts = now; vuaLuu.push({ coll: k, rec: r }); } // vừa sửa
        else if (!r._ts) r._ts = p._ts || now;                                          // giữ dấu cũ
      });
      // KHÔNG sinh bia mộ ở đây. Chỉ hàm xoá trong app mới được phép.
    });
    appendJournal(vuaLuu);
    try { localStorage.setItem(PREV_KEY, JSON.stringify(data)); } catch (e) {}
    return data;
  }

  // ---------------------------------------------------------
  // GỘP: trái tim của bản vá. Không bên nào xoá được bản ghi của bên kia.
  // ---------------------------------------------------------
  function mergeTombstones(a, b) {
    const out = {};
    [a || {}, b || {}].forEach(src => {
      Object.keys(src).forEach(k => {
        out[k] = out[k] || {};
        Object.keys(src[k] || {}).forEach(id => {
          out[k][id] = Math.max(out[k][id] || 0, src[k][id] || 0);
        });
      });
    });
    return out;
  }
  // aTime/bTime: thời điểm của cả cục, chỉ dùng cho phần không có id (settings)
  function mergeDB(a, b, aTime, bTime) {
    if (!a) return b ? clone(b) : null;
    if (!b) return clone(a);
    const newer = (bTime > aTime) ? b : a;
    const out = clone(newer);                      // settings & các field lẻ lấy theo bản mới hơn
    const tomb = mergeTombstones(a._deleted, b._deleted);
    out._deleted = tomb;

    COLLECTIONS.forEach(k => {
      const map = {};
      [a, b].forEach(src => {
        (Array.isArray(src[k]) ? src[k] : []).forEach(r => {
          if (!r || typeof r !== 'object' || r.id == null) return;
          const ex = map[r.id];
          if (!ex || (r._ts || 0) > (ex._ts || 0)) map[r.id] = r;
        });
      });
      const t = tomb[k] || {};
      out[k] = Object.keys(map)
        .map(id => map[id])
        // chỉ loại bỏ bản ghi nếu nó bị xoá SAU lần sửa cuối cùng
        .filter(r => !(t[r.id] != null && t[r.id] >= (r._ts || 0)));
    });
    return out;
  }

  function countRecords(d) {
    let n = 0;
    COLLECTIONS.forEach(k => { n += (Array.isArray(d && d[k]) ? d[k].length : 0); });
    return n;
  }

  // ---------------------------------------------------------
  // Áp dữ liệu đã gộp vào app đang chạy (không F5 đột ngột)
  // ---------------------------------------------------------
  let pendingApply = null;
  function applyToApp(data) {
    if (isModalOpen()) { pendingApply = data; return; } // đang nhập dở -> chờ
    if (typeof window.__syncApplyDB === 'function') {
      try { window.__syncApplyDB(data); return; } catch (e) { console.error('[sync] applyDB lỗi', e); }
    }
    location.reload();
  }
  setInterval(function () {
    if (pendingApply && !isModalOpen()) { const d = pendingApply; pendingApply = null; applyToApp(d); }
  }, 1200);

  // ---------------------------------------------------------
  // VÒNG ĐỒNG BỘ: tải về -> gộp -> lưu máy -> đẩy bản đã gộp lên
  // ---------------------------------------------------------
  let syncing = false, dirty = false, pushTimer = null;

  async function syncNow(reason) {
    if (syncing) { dirty = true; return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    // Đang mở form nhập liệu -> không đụng gì vào ổ đĩa. Trước đây phần đồng bộ
    // vẫn ghi xuống ổ đĩa trong khi màn hình bị hoãn cập nhật, làm bản trong bộ
    // nhớ trang cũ hơn bản dưới ổ đĩa — đúng khe hở gây xoá oan ngày 03/08.
    if (isModalOpen()) { dirty = true; return; }
    syncing = true;
    setStatus('syncing');
    try {
      const local = readLocal();

      const { data: row, error } = await client
        .from(TABLE).select('data, updated_at').eq('id', ROW_ID).maybeSingle();
      if (error) throw error;

      const localTime = getMeta().updatedAt || 0;
      const cloud = row && row.data ? row.data : null;
      const cloudTime = row && row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const cloudReal = !!cloud && !isRiskyData(cloud);

      if (!local && !cloudReal) { setStatus('synced'); return; }

      // CHỐT CHẶN: máy đang rỗng hoặc còn nguyên dữ liệu mẫu (máy mới, vừa xoá
      // localStorage, tải hụt...) mà cloud đang có dữ liệu thật -> chỉ nhận về,
      // TUYỆT ĐỐI không gộp và không đẩy lên, kẻo dữ liệu mẫu chui vào dữ liệu thật.
      if (cloudReal && isRiskyData(local)) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(cloud));
        try { localStorage.setItem(PREV_KEY, JSON.stringify(cloud)); } catch (e) {}
        setMeta({ updatedAt: cloudTime, pushedAt: cloudTime });
        applyToApp(cloud);
        setStatus('synced');
        return;
      }

      if (!local) { setStatus('synced'); return; }

      // Dọn tàn dư dữ liệu mẫu: máy mới vừa kịp nhập vài thứ trước khi đồng bộ
      // xong thì vẫn còn lẫn sản phẩm/khách mẫu — không được để chúng lên cloud.
      const work = cloudReal ? stripSeedRemnants(local, cloud) : local;

      let merged = cloudReal ? mergeDB(work, cloud, localTime, cloudTime) : work;

      // Bảo hiểm cuối: sau khi gộp mà số bản ghi lại ÍT hơn bản trong máy
      // thì có gì đó sai -> giữ nguyên bản máy, báo lỗi, không đụng vào.
      if (countRecords(merged) < countRecords(work)) {
        console.error('[sync] Gộp cho ra ít dữ liệu hơn bản trong máy — huỷ gộp để an toàn.');
        pushBackup(local, 'huỷ gộp bất thường');
        merged = work;
      }

      const changedLocally = JSON.stringify(merged) !== JSON.stringify(local);
      if (changedLocally) {
        pushBackup(local, 'trước khi nhận dữ liệu từ cloud');
        localStorage.setItem(LOCAL_KEY, JSON.stringify(merged));
        try { localStorage.setItem(PREV_KEY, JSON.stringify(merged)); } catch (e) {}
        applyToApp(merged);
      }

      // CHỈ ghi lên cloud khi thật sự có gì khác. Ghi đè vô cớ làm dấu thời gian
      // trên cloud nhảy mới liên tục, khiến thiết bị còn chạy bản cũ tưởng là có
      // dữ liệu mới rồi tự ghi đè lên chính nó — đúng lỗi đã làm mất hoá đơn.
      const needPush = !cloud || JSON.stringify(merged) !== JSON.stringify(cloud);
      const now = Date.now();
      if (needPush) {
        const { error: upErr } = await client.from(TABLE).upsert({
          id: ROW_ID, data: merged, updated_at: new Date(now).toISOString()
        });
        if (upErr) throw upErr;
        setMeta({ updatedAt: now, pushedAt: now, cloudSeen: now });
      } else {
        setMeta({ pushedAt: now, cloudSeen: now });
      }
      setStatus('synced');
    } catch (e) {
      console.error('[sync] Đồng bộ thất bại:', e);
      setStatus(navigator.onLine ? 'error' : 'offline', (e && (e.message || e.error_description)) || String(e));
      setTimeout(() => { dirty = true; }, 0);   // để vòng sau thử lại
    } finally {
      syncing = false;
      if (dirty) { dirty = false; setTimeout(() => syncNow('thử lại'), 3000); }
    }
  }

  function schedulePush() {
    setStatus(navigator.onLine ? 'pending' : 'offline');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow('có thay đổi'), DEBOUNCE_MS);
  }

  // ---------------------------------------------------------
  // Gắn vào saveDB() của app
  // ---------------------------------------------------------
  function hookSaveDB() {
    if (typeof window.saveDB !== 'function') { setTimeout(hookSaveDB, 200); return; }
    const originalSaveDB = window.saveDB;
    window.saveDB = function () {
      originalSaveDB.apply(this, arguments);
      try {
        const d = readLocal();
        if (d) {
          stampChanges(d);
          localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
          pushBackup(d, 'sau khi lưu');
        }
      } catch (e) { console.error('[sync] stamp lỗi', e); }
      setMeta({ updatedAt: Date.now() });
      schedulePush();
    };
  }

  // ---------------------------------------------------------
  // Định kỳ + khi quay lại app + khi có mạng lại
  // ---------------------------------------------------------
  let pollTimer = null;
  // Chỉ hỏi mốc thời gian (vài chục byte), có thay đổi thật mới tải cả cục về.
  // Trước đây mỗi lần dò là tải nguyên 111 KB — rất tốn 4G ngoài cửa hàng.
  async function pollLight() {
    if (!navigator.onLine || syncing || isModalOpen()) return;
    try {
      const { data, error } = await client
        .from(TABLE).select('updated_at').eq('id', ROW_ID).maybeSingle();
      if (error) throw error;
      const t = data && data.updated_at ? new Date(data.updated_at).getTime() : 0;
      if (t > (getMeta().cloudSeen || 0)) syncNow('cloud có thay đổi');
    } catch (e) {
      console.warn('[sync] Dò cloud thất bại, sẽ thử lại:', e && e.message);
    }
  }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollLight, POLL_INTERVAL);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isModalOpen()) syncNow('quay lại app');
  });
  window.addEventListener('online', () => syncNow('có mạng lại'));
  window.addEventListener('offline', () => setStatus('offline'));

  // Cảnh báo nếu đóng app khi còn thay đổi chưa lên cloud
  window.addEventListener('beforeunload', function (e) {
    const m = getMeta();
    if (m.updatedAt && (!m.pushedAt || m.pushedAt < m.updatedAt)) {
      e.preventDefault(); e.returnValue = '';
      return '';
    }
  });

  // Mở ra cho việc kiểm thử/gỡ lỗi (không dùng trong luồng chạy bình thường)
  window.__syncInternals = { mergeDB, stampChanges, mergeTombstones, countRecords, isRiskyData, COLLECTIONS, syncNow };

  ensureIndicator();
  setStatus('syncing');
  hookSaveDB();
  // Lần chạy đầu: chụp ảnh gốc để lần sau biết cái gì đã đổi
  // Dọn bớt bản sao thừa do bản trước giữ tới 12 bản (ngốn ~4 MB, sát trần trình duyệt)
  try {
    let list = JSON.parse(localStorage.getItem(BACKUP_KEY)) || [];
    if (list.length > MAX_BACKUPS) {
      const truoc = list.length;
      list = list.slice(-MAX_BACKUPS);              // giữ lại các bản MỚI nhất
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
      console.log('[sync] Dọn bản sao cũ: ' + truoc + ' -> ' + list.length + ' bản.');
    }
  } catch (e) {}

  try {
    const first = readLocal();
    if (first) {
      pushBackup(first, 'khi mở app');
      if (!localStorage.getItem(PREV_KEY)) localStorage.setItem(PREV_KEY, JSON.stringify(first));
    }
  } catch (e) {}
  syncNow('mở app');
  startPolling();
})();
