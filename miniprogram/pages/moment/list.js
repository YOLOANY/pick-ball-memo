// pages/moment/list.js
const { callCloud } = require('../../utils/cloud.js');

const SPORT_MAP = {
  tennis: '网球', basketball: '篮球', badminton: '羽毛球',
  football: '足球', pingpong: '乒乓球', volleyball: '排球', other: '运动'
};
Page({
  data: { list: [], defaultAvatar: '/images/icons/avatar.png' },
  onLoad() { this.fetch(); },
  onShow() { if (this.data.list.length > 0) this.fetch(true); },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()); },

  async fetch(silent) {
    try {
      const resp = await callCloud('moment', { type: 'list' });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((m) => ({
          ...m,
          sportLabel: SPORT_MAP[m.sport] || '运动',
          timeAgo: this._timeAgo(m.createdAt)
        }));
        this.setData({ list });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  _timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}小时前`;
    const day = Math.floor(hr / 24);
    return `${day}天前`;
  },

  onTapItem(e) { wx.navigateTo({ url: `/pages/moment/detail?id=${e.currentTarget.dataset.id}` }); },
  onTapPublish() { wx.navigateTo({ url: '/pages/moment/publish' }); }
});
