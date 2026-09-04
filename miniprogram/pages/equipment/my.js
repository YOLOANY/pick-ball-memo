// pages/equipment/my.js
const STATUS_MAP = { pending: '待确认', confirmed: '已确认', returned: '已归还', cancelled: '已取消' };
Page({
  data: { tab: 'borrows', list: [], loading: false },
  onLoad() { this.fetch(); },
  onShow() { if (this.data.list.length > 0 || this.data.tab) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab, list: [] });
    this.fetch();
  },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    const type = this.data.tab === 'borrows' ? 'myBorrows' : 'myPublished';
    try {
      const resp = await wx.cloud.callFunction({ name: 'equipment', data: { type } });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((o) => ({
          ...o,
          statusLabel: STATUS_MAP[o.status] || o.status || '可租借',
          createdAtText: this._fmt(o.createdAt)
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

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  onTapItem(e) { wx.navigateTo({ url: `/pages/equipment/detail?id=${e.currentTarget.dataset.id}` }); },
  onPublish() { wx.navigateTo({ url: '/pages/equipment/publish' }); },

  async onCancel(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await new Promise((r) => wx.showModal({ title: '提示', content: '确认取消该租借？', success: (res) => r(res.confirm) }));
    if (!confirmed) return;
    try {
      const resp = await wx.cloud.callFunction({ name: 'equipment', data: { type: 'cancel', id } });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已取消', icon: 'success' });
        this.fetch(true);
      } else {
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '操作失败', icon: 'none' });
      }
    } catch (e) { wx.showToast({ title: '网络异常', icon: 'none' }); }
  }
});
