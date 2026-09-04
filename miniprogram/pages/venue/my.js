// pages/venue/my.js
const { callCloud } = require('../../utils/cloud.js');

const STATUS_MAP = { pending: '待确认', confirmed: '已确认', cancelled: '已取消' };
Page({
  data: { list: [], loading: true },
  onLoad() { this.fetch(); },
  onShow() { if (this.data.list.length > 0 || !this.data.loading) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },

  async fetch(silent) {
    if (!silent) this.setData({ loading: true });
    try {
      const resp = await callCloud('venue', { type: 'myOrders' });
      if (resp.result && resp.result.success) {
        // 关键：不用 { ...o, ... } 对象 spread → Babel helper 问题,改用 Object.assign
        const list = (resp.result.data.list || []).map((o) => Object.assign({}, o, {
          statusLabel: STATUS_MAP[o.status] || o.status,
          createdAtText: this._fmt(o.createdAt)
        }));
        this.setData({ list, loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  async onCancel(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await new Promise((r) => wx.showModal({ title: '提示', content: '确认取消该预约？', success: (res) => r(res.confirm) }));
    if (!confirmed) return;
    try {
      const resp = await callCloud('venue', { type: 'cancelOrder', id });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已取消', icon: 'success' });
        this.fetch(true);
      } else {
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '操作失败', icon: 'none' });
      }
    } catch (e) { wx.showToast({ title: '网络异常', icon: 'none' }); }
  }
});
