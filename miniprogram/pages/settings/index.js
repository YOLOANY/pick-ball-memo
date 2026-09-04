// pages/settings/index.js
// 设置页
//   - 清理缓存：只清本应用的 wx.storage，不动云端数据
//   - 检查更新：调 wx.getUpdateManager
//   - 退出登录：清掉 app.globalData.userInfo，但保留 _openid 让下次静默登录仍能识别

const app = getApp();
const VERSION = '1.0.0';

Page({
  data: {
    version: VERSION,
    cacheSizeText: '0 KB'
  },

  onLoad() { this._calcCacheSize(); },
  onShow() { this._calcCacheSize(); },

  // 工具：算本地缓存大小（粗略估算，把所有 storage key 的 value 长度加起来）
  _calcCacheSize() {
    try {
      const info = wx.getStorageInfoSync();
      const bytes = (info.keys || []).reduce((sum, k) => {
        try {
          const v = wx.getStorageSync(k);
          const s = typeof v === 'string' ? v : JSON.stringify(v || '');
          return sum + s.length;
        } catch (e) { return sum; }
      }, 0);
      this.setData({ cacheSizeText: this._fmtSize(bytes) });
    } catch (e) {
      this.setData({ cacheSizeText: '未知' });
    }
  },

  _fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  },

  // ===== 清理缓存 =====
  onClearCache() {
    wx.showModal({
      title: '清理缓存?',
      content: '会清除本地存储的偏好设置等,不影响云端数据。确定清理吗?',
      success: (res) => {
        if (!res.confirm) return;
        try {
          // 白名单：保留必要的 key（这里只有 userInfo 的 openid 不在 storage）
          // 偏好 / 手机号都属于"可重建"的数据,清掉
          const keep = new Set();
          const info = wx.getStorageInfoSync();
          (info.keys || []).forEach((k) => {
            if (!keep.has(k)) {
              try { wx.removeStorageSync(k); } catch (e) {}
            }
          });
          this._calcCacheSize();
          wx.showToast({ title: '已清理', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '清理失败', icon: 'none' });
        }
      }
    });
  },

  // ===== 检查更新 =====
  onCheckUpdate() {
    if (!wx.getUpdateManager) {
      return wx.showToast({ title: '当前微信版本过低', icon: 'none' });
    }
    const um = wx.getUpdateManager();
    um.onCheckForUpdate((res) => {
      if (!res.hasUpdate) {
        wx.showToast({ title: '已是最新版本', icon: 'success' });
      }
    });
    um.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已准备好,是否重启应用?',
        success: (r) => { if (r.confirm) um.applyUpdate(); }
      });
    });
    um.onUpdateFailed(() => {
      wx.showToast({ title: '更新失败,请稍后再试', icon: 'none' });
    });
  },

  // ===== 退出登录 =====
  onLogout() {
    wx.showModal({
      title: '退出登录?',
      content: '会清掉本地用户信息,你的 openid 仍保留,下次进入可静默恢复。',
      confirmText: '退出',
      confirmColor: '#C75A5A',
      success: (res) => {
        if (!res.confirm) return;
        // 关键：保留 _openid，让下次进入能识别用户；只清 nickName/avatarUrl
        const cur = (app && app.globalData && app.globalData.userInfo) || {};
        app.globalData.userInfo = cur._openid ? { _openid: cur._openid } : null;
        // 同时清掉本地缓存中可能存在的 userInfo 镜像
        try { wx.removeStorageSync('userInfo'); } catch (e) {}
        wx.showToast({ title: '已退出', icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/index/index' });
        }, 800);
      }
    });
  }
});
