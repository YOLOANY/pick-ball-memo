// pages/moment/detail.js
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');

const SPORT_MAP = {
  tennis: '网球', basketball: '篮球', badminton: '羽毛球',
  football: '足球', pingpong: '乒乓球', volleyball: '排球', other: '运动'
};

Page({
  data: { id: '', moment: null, isOwner: false, defaultAvatar: '/images/icons/avatar.png' },
  onLoad(query) { this.setData({ id: query.id }); this.fetch(); },

  async fetch() {
    try {
      const resp = await callCloud('moment', { type: 'detail', id: this.data.id });
      if (resp.result && resp.result.success) {
        const m = resp.result.data;
        const me = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
        this.setData({
          // 关键：不用 { ...m, ... } 对象 spread → Babel helper 问题,改用 Object.assign
          moment: Object.assign({}, m, {
            sportLabel: SPORT_MAP[m.sport] || '运动',
            createdAtText: this._fmt(m.createdAt)
          }),
          isOwner: me && m._openid === me
        });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  onPreviewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.url, urls: this.data.moment.images });
  },

  async onDelete() {
    const confirmed = await new Promise((r) => wx.showModal({ title: '提示', content: '确认删除该动态？', success: (res) => r(res.confirm) }));
    if (!confirmed) return;
    try {
      const resp = await callCloud('moment', { type: 'delete', id: this.data.id });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      } else {
        wx.showToast({ title: (resp.result && resp.result.errMsg) || '删除失败', icon: 'none' });
      }
    } catch (e) { wx.showToast({ title: '调用失败，请看控制台', icon: 'none' }); }
  }
});
