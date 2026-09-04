// pages/venue/list.js
// 场地列表
const SPORT_MAP = {
  tennis: { label: '网球', emoji: '🎾' },
  basketball: { label: '篮球', emoji: '🏀' },
  badminton: { label: '羽毛球', emoji: '🏸' },
  football: { label: '足球', emoji: '⚽' },
  pingpong: { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球', emoji: '🏐' }
};

Page({
  data: { list: [], loading: true },
  onLoad() { this.fetch(); },
  onShow() { if (this.data.list.length > 0) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await wx.cloud.callFunction({ name: 'venue', data: { type: 'list' } });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((v) => ({
          ...v,
          sportEmoji: (SPORT_MAP[v.sport] || {}).emoji || '🏅'
        }));
        this.setData({ list, loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '云函数未部署', icon: 'none' });
    }
  },

  onTapItem(e) {
    wx.navigateTo({ url: `/pages/venue/detail?id=${e.currentTarget.dataset.id}` });
  },

  // 初始化示例数据
  async onSeed() {
    wx.showLoading({ title: '初始化中…', mask: true });
    try {
      const resp = await wx.cloud.callFunction({ name: 'venue', data: { type: 'seed' } });
      wx.hideLoading();
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '初始化成功', icon: 'success' });
        this.fetch();
      } else {
        wx.showToast({ title: '初始化失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '云函数未部署', icon: 'none' });
    }
  }
});
