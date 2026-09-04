// pages/equipment/list.js
const CATEGORY_MAP = {
  racket:  { label: '球拍类', emoji: '🏸' },
  ball:    { label: '球类',   emoji: '⚽' },
  shoe:    { label: '鞋服',   emoji: '👟' },
  other:   { label: '其他',   emoji: '🎽' }
};
Page({
  data: { list: [], loading: true },
  onLoad() { this.fetch(); },
  onShow() { if (this.data.list.length > 0) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },
  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await wx.cloud.callFunction({ name: 'equipment', data: { type: 'list' } });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((e) => ({
          ...e,
          categoryLabel: (CATEGORY_MAP[e.category] || {}).label || e.category,
          categoryEmoji: (CATEGORY_MAP[e.category] || {}).emoji || '🎽'
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
  onTapItem(e) { wx.navigateTo({ url: `/pages/equipment/detail?id=${e.currentTarget.dataset.id}` }); },
  onTapPublish() { wx.navigateTo({ url: '/pages/equipment/publish' }); }
});
