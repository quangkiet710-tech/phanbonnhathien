/**
 * ĐỒNG BỘ DỮ LIỆU REALTIME - Thêm vào project phanbonnhathien
 * 
 * Cách sử dụng:
 * 1. Copy file này vào project (cùng folder với index.html)
 * 2. Thêm dòng này vào HTML (trước </body>):
 *    <script src="./realtime-sync.js"></script>
 * 3. Xong! Dữ liệu sẽ tự động đồng bộ trên tất cả thiết bị
 */

// Thêm dòng này nếu bạn chưa import supabase
// const { createClient } = window.supabase;

// Lấy Supabase client từ file hiện tại
const SUPABASE_URL = 'https://yzmdxyxdzksleslwiyjg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6bWR4eXhkemtzbGVzbHdpeWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDY3NTI0MjgsImV4cCI6MjAyMjMyODQyOH0.eHI2NGYxaWFPNkpxSGFfRVhhNXVGN05pOVBHSFhvNFY';

// Tạo kết nối nếu chưa có
window.supabaseSync = window.supabase || 
  window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

class RealtimeSync {
  constructor() {
    this.subscriptions = [];
    this.isOnline = navigator.onLine;
    this.setupListeners();
  }

  /**
   * Bắt đầu lắng nghe thay đổi realtime trên một bảng
   * @param {string} tableName - Tên bảng trong Supabase
   * @param {function} onDataChange - Hàm callback khi dữ liệu thay đổi
   */
  subscribeToTable(tableName, onDataChange) {
    const channel = window.supabaseSync
      .channel(`${tableName}-changes`)
      .on(
        'postgres_changes',
        {
          event: '*', // Lắng nghe INSERT, UPDATE, DELETE
          schema: 'public',
          table: tableName
        },
        (payload) => {
          console.log(`📡 ${tableName} thay đổi:`, payload);
          
          // Gọi hàm callback
          if (onDataChange && typeof onDataChange === 'function') {
            onDataChange({
              action: payload.eventType, // INSERT, UPDATE, DELETE
              data: payload.new,
              oldData: payload.old
            });
          }

          // Phát event tùy chỉnh để các phần khác của app nghe
          window.dispatchEvent(new CustomEvent('dataSync', {
            detail: {
              table: tableName,
              action: payload.eventType,
              data: payload.new
            }
          }));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Đã kết nối realtime: ${tableName}`);
        }
      });

    this.subscriptions.push(channel);
    return channel;
  }

  /**
   * Polling fallback - kiểm tra update mỗi 5 giây
   * Sử dụng nếu Realtime không hoạt động
   */
  setupPolling(tableName, onDataChange, interval = 5000) {
    let lastFetch = null;

    const poll = async () => {
      if (!this.isOnline) return;

      try {
        const { data } = await window.supabaseSync
          .from(tableName)
          .select()
          .order('created_at', { ascending: false });

        if (JSON.stringify(data) !== JSON.stringify(lastFetch)) {
          lastFetch = data;
          if (onDataChange) {
            onDataChange({ data, action: 'POLL' });
          }
        }
      } catch (error) {
        console.error(`❌ Polling error ${tableName}:`, error);
      }
    };

    // Poll ngay và lặp lại
    poll();
    const pollInterval = setInterval(poll, interval);

    return () => clearInterval(pollInterval);
  }

  /**
   * Lưu thay đổi khi offline, sync khi online
   */
  setupOfflineQueue(tableName) {
    const queueKey = `sync_queue_${tableName}`;

    return {
      addToQueue: (action, data) => {
        const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
        queue.push({
          timestamp: Date.now(),
          action,
          data
        });
        localStorage.setItem(queueKey, JSON.stringify(queue));
        console.log(`📝 Lưu offline: ${tableName}`, action);
      },

      syncQueue: async () => {
        const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
        if (queue.length === 0) return;

        console.log(`🔄 Sync ${queue.length} items từ ${tableName}`);

        for (const item of queue) {
          try {
            if (item.action === 'INSERT') {
              await window.supabaseSync.from(tableName).insert(item.data);
            } else if (item.action === 'UPDATE') {
              await window.supabaseSync
                .from(tableName)
                .update(item.data)
                .eq('id', item.data.id);
            } else if (item.action === 'DELETE') {
              await window.supabaseSync
                .from(tableName)
                .delete()
                .eq('id', item.data.id);
            }
          } catch (error) {
            console.error('Sync error:', error);
          }
        }

        localStorage.removeItem(queueKey);
        console.log('✅ Sync xong!');
      }
    };
  }

  /**
   * Lắng nghe khi online/offline
   */
  setupListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🟢 Đã kết nối internet');
      window.dispatchEvent(new CustomEvent('appOnline'));
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('🔴 Mất kết nối internet');
      window.dispatchEvent(new CustomEvent('appOffline'));
    });
  }

  /**
   * Dừng tất cả subscriptions
   */
  unsubscribeAll() {
    this.subscriptions.forEach(sub => {
      window.supabaseSync.removeChannel(sub);
    });
    this.subscriptions = [];
  }
}

// Tạo instance toàn cầu
window.realtimeSync = new RealtimeSync();

console.log('✨ Realtime Sync initialized - Dữ liệu sẽ tự động đồng bộ!');
