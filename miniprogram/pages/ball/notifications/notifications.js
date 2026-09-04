// pages/ball/notifications/notifications.js
// 提醒中心：展示所有 status='ready' / 'read' 的提醒
// 职责：
//   1. 拉取 ballReminder.notificationList
//   2. 按时间倒序展示，每条卡片显示运动项目 / 时间 / 地点
//   3. ready 状态的卡片可点击 → markRead + 跳详情
//   4. 顶部「全部已读」按钮 → markAllRead
//   5. 下拉刷新

const { callCloud } = require('../../../utils/cloud.js');

Page({
  data: {
    list: [],
    loading: true,
    unreadCount: 0
  },

  onLoad() {
    this._isLoaded = true;
    this.fetchList();
  },

  onShow() {
    if (this._isLoaded) this.fetchList(true);
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  async fetchList(silent = false) {
    if (!silent) this.setData({ loading: true });
    try {
      const r = await callCloud('ballReminder', { type: 'notificationList' });
      if (r.result && r.result.success) {
        const raw = r.result.data.list || [];
        const list = raw.map((it) => this._mapItem(it));
        this.setData({
          list,
          unreadCount: r.result.data.unreadCount || 0,
          loading: false
        });
      } else {
        this.setData({ list: [], unreadCount: 0, loading: false });
        wx.showToast({
          title: (r.result && r.result.errMsg) || '加载失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('[notifications] fetch failed', e);
      this.setData({ list: [], unreadCount: 0, loading: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 字段映射：与全局风格保持一致（用 Object.assign 避免 spread 触发 Babel 问题）
  _mapItem(item) {
    const notifiedAtText = this._formatDateTime(item.notifiedAt);
    const readAtText = item.readAt ? this._formatDateTime(item.readAt) : '';
    return Object.assign({}, item, {
      notifiedAtText,
      readAtText
    });
  },

  _formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 点击 ready 状态的卡片 → 标记已读 + 跳详情
  async onTapItem(e) {
    const { id, index } = e.currentTarget.dataset;
    const item = this.data.list[index];
    if (!item) return;
    // 先标记已读（已读的不重复标记）
    if (item.status === 'ready') {
      try {
        await callCloud('ballReminder', { type: 'markRead', id: id });
        // 本地更新状态
        this.setData({
          [`list[${index}].status`]: 'read',
          [`list[${index}].readAt`]: Date.now(),
          [`list[${index}].readAtText`]: this._formatDateTime(Date.now()),
          unreadCount: Math.max(0, this.data.unreadCount - 1)
        });
      } catch (e) {
        // 标记失败不阻塞跳转
      }
    }
    // 跳详情
    if (item.postId) {
      wx.navigateTo({ url: '/pages/ball/detail?id=' + item.postId });
    }
  },

  // 全部已读
  async onMarkAllRead() {
    if (this.data.unreadCount === 0) return;
    try {
      const r = await callCloud('ballReminder', { type: 'markAllRead' });
      if (r.result && r.result.success) {
        wx.showToast({ title: '已全部标记为已读', icon: 'success' });
        this.fetchList(true);
      } else {
        wx.showToast({
          title: (r.result && r.result.errMsg) || '操作失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  }
});
